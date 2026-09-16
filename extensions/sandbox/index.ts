/**
 * sandbox — OS-level sandboxing for pi's bash tool
 *
 * Wraps every bash command (including user `!` commands) in an OS-level
 * sandbox via @anthropic-ai/sandbox-runtime (the runtime behind Claude
 * Code's sandbox): sandbox-exec on macOS, bubblewrap on Linux. Filesystem
 * writes are confined to the project + /tmp, sensitive dotfolders
 * (~/.ssh, ~/.aws, ~/.gnupg) are unreadable, and network egress is limited
 * to a configurable domain allowlist (npm/pypi/github by default).
 *
 * Sandboxed commands delegate to pi's own local bash backend, so they keep
 * full parity with the built-in bash tool: env/session variables (PI_*),
 * the ~/.pi/agent/bin PATH entry, timeout/abort handling, and process-tree
 * cleanup on kill.
 *
 * Toggle: `/sandbox on` / `/sandbox off` at runtime, or `--no-sandbox` flag,
 * or "enabled": false in config. `/sandbox off` tears the runtime down
 * (host-side proxy and bridges) instead of leaving it listening. A single
 * status line ("sandbox on"/"sandbox off") is rendered above the input box.
 * Config files (project overrides global; config arrays replace the
 * defaults wholesale):
 *   - ~/.pi/agent/sandbox.json
 *   - <project>/.pi/sandbox.json — only honored when the project is
 *     trusted (ctx.isProjectTrusted()), so an untrusted checkout cannot
 *     weaken the sandbox for itself, and the file itself is write-denied
 *     inside the sandbox so bash cannot weaken it for the next session.
 *
 * Git worktrees and submodules keep their metadata outside the project
 * directory; those git directories are detected at enable time and added
 * to the write allowlist automatically (a plain clone needs nothing — its
 * .git is inside the project). hooks/ and config/ inside every git
 * directory stay write-denied: they execute or load in later unsandboxed
 * git runs, so writing them from inside the sandbox would be an escape.
 *
 * Install: pi install npm:@pi-spice/sandbox
 * Quick test: pi -e ./extensions/sandbox
 *
 * Linux requires: bubblewrap, socat, ripgrep (e.g. `sudo apt install
 * bubblewrap socat ripgrep`). macOS works out of the box. Windows is
 * unsupported; bash runs unsandboxed there.
 *
 * Known limitation (v1, matches pi's official sandbox example): if sandbox
 * initialization fails, bash falls back to unsandboxed execution with an
 * error notification. Fail-closed behavior is a planned iteration. Bash
 * calls that arrive while initialization is still in flight wait for it
 * rather than racing to unsandboxed execution.
 *
 * Threat model: accident-and-exfiltration containment, not a hard boundary
 * against adversarial kernel-level exploits — the sandbox shares the host
 * kernel by design. Protects against: accidental writes outside the project,
 * stray `rm -rf`, prompt-injection-driven exfiltration to unexpected
 * domains, and reading credential folders from bash. Does NOT protect
 * against kernel 0-days, out-of-sandbox processes (e.g. MCP servers), or
 * secrets the agent reads into its own context. The runtime dependency on
 * @anthropic-ai/sandbox-runtime is a deliberate deviation from the repo's
 * zero-dependency convention: security-boundary code should be battle-tested.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	SandboxManager,
	type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import {
	type BashOperations,
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	createBashTool,
	createLocalBashOperations,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface SandboxConfig extends SandboxRuntimeConfig {
	enabled?: boolean;
}

const DEFAULT_CONFIG: SandboxConfig = {
	enabled: true,
	network: {
		allowedDomains: [
			"npmjs.org",
			"*.npmjs.org",
			"registry.npmjs.org",
			"registry.yarnpkg.com",
			"pypi.org",
			"*.pypi.org",
			"files.pythonhosted.org",
			"proxy.golang.org",
			"sum.golang.org",
			"crates.io",
			"index.crates.io",
			"static.crates.io",
			"github.com",
			"*.github.com",
			"api.github.com",
			"raw.githubusercontent.com",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
		allowWrite: [".", "/tmp"],
		// Root-level entries plus `**/` variants so nested secrets
		// (packages/x/.env, config/*.key, …) are covered too. On Linux
		// (bubblewrap) sandbox-runtime enforces exact paths only, so there
		// just the root-level `.env` applies; the glob entries are skipped.
		denyWrite: [
			".env",
			".env.*",
			"*.pem",
			"*.key",
			"**/.env",
			"**/.env.*",
			"**/*.pem",
			"**/*.key",
		],
	},
};

/**
 * Validate the shape of a config file. Returns the parsed object, or null
 * when it is not a JSON object with the expected keys — a typo'd config
 * should produce one clear warning up front, not a per-command crash.
 */
function validateConfigShape(
	path: string,
	parsed: unknown,
): Partial<SandboxConfig> | null {
	const invalid = (why: string): null => {
		console.error(`Warning: ${path}: ${why} — file ignored.`);
		return null;
	};

	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return invalid("top-level value must be a JSON object");
	}
	const config = parsed as Record<string, unknown>;

	if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
		return invalid(`"enabled" must be a boolean`);
	}
	for (const section of ["network", "filesystem"] as const) {
		const value = config[section];
		if (value === undefined) continue;
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return invalid(`"${section}" must be an object`);
		}
		const arrayKeys: Record<string, readonly string[]> = {
			network: ["allowedDomains", "deniedDomains"],
			filesystem: ["denyRead", "allowWrite", "denyWrite"],
		};
		for (const key of arrayKeys[section]) {
			const list = (value as Record<string, unknown>)[key];
			if (list === undefined) continue;
			if (!Array.isArray(list) || list.some((e) => typeof e !== "string")) {
				return invalid(`"${section}.${key}" must be an array of strings`);
			}
		}
	}
	return config as Partial<SandboxConfig>;
}

function readConfigFile(path: string): Partial<SandboxConfig> {
	if (!existsSync(path)) return {};
	try {
		return validateConfigShape(path, JSON.parse(readFileSync(path, "utf-8"))) ?? {};
	} catch (e) {
		console.error(`Warning: Could not parse ${path}: ${e}`);
		return {};
	}
}

function projectConfigPath(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, "sandbox.json");
}

function loadConfig(cwd: string, trusted = true): SandboxConfig {
	// An untrusted project checkout must not be able to weaken the sandbox
	// for itself (disable it, widen the egress allowlist, …): the project
	// config is only read once pi's project trust is active for the session.
	const projectConfig = trusted
		? readConfigFile(projectConfigPath(cwd))
		: {};
	if (!trusted && existsSync(projectConfigPath(cwd))) {
		console.error(
			`Warning: ${projectConfigPath(cwd)} ignored — project is not trusted.`,
		);
	}
	const globalConfig = readConfigFile(join(getAgentDir(), "sandbox.json"));

	return mergeConfig(mergeConfig(DEFAULT_CONFIG, globalConfig), projectConfig);
}

function mergeConfig(
	base: SandboxConfig,
	overrides: Partial<SandboxConfig>,
): SandboxConfig {
	const result: SandboxConfig = { ...base };

	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (overrides.network) {
		result.network = { ...base.network, ...overrides.network };
	}
	if (overrides.filesystem) {
		result.filesystem = { ...base.filesystem, ...overrides.filesystem };
	}

	return result;
}

/**
 * Anchor relative filesystem entries to the session cwd. sandbox-runtime
 * would anchor them to the process launch directory instead, which silently
 * parts ways with the session cwd when a session is resumed from elsewhere.
 */
function anchorEntries(entries: string[], cwd: string): string[] {
	return entries.map((entry) =>
		entry.startsWith("~") || entry.startsWith("/") ? entry : resolve(cwd, entry),
	);
}

/**
 * Git metadata directories that live outside the session cwd — the
 * per-worktree admin dir and shared common dir of a `git worktree`
 * checkout, or a submodule's gitdir. Without write access to them,
 * `git commit` fails with EROFS inside the sandbox. A plain clone's .git
 * sits inside the project and is not returned.
 */
function detectExternalGitDirs(cwd: string): string[] {
	const git = (args: string[]): string | null => {
		try {
			return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
		} catch {
			return null; // git missing, or cwd is not a repository
		}
	};
	const gitDir = git(["rev-parse", "--absolute-git-dir"]);
	if (!gitDir) return [];
	const commonDirRaw = git(["rev-parse", "--git-common-dir"]);
	const commonDir = commonDirRaw ? resolve(cwd, commonDirRaw) : null;

	const under = (p: string, root: string) => p === root || p.startsWith(root + "/");
	const dirs = new Set<string>();
	if (!under(gitDir, cwd)) dirs.add(gitDir);
	if (commonDir && !under(commonDir, cwd)) dirs.add(commonDir);
	return [...dirs];
}

/**
 * Harden the filesystem section at initialization: anchor relative entries
 * to the session cwd, and deny writes to the project sandbox config itself
 * so sandboxed commands cannot rewrite the policy the next session loads.
 * External git directories (worktrees/submodules) become writable so git
 * operations work, with their hooks/ and config/ carved back out — see
 * detectExternalGitDirs.
 */
function hardenedFilesystem(
	config: SandboxConfig,
	cwd: string,
	gitDirs: string[],
): SandboxRuntimeConfig["filesystem"] {
	return {
		...config.filesystem,
		denyRead: anchorEntries(config.filesystem.denyRead ?? [], cwd),
		allowWrite: [
			...anchorEntries(config.filesystem.allowWrite ?? [], cwd),
			...gitDirs,
		],
		denyWrite: [
			...anchorEntries(config.filesystem.denyWrite ?? [], cwd),
			projectConfigPath(cwd),
			...gitDirs.flatMap((dir) => [join(dir, "hooks"), join(dir, "config")]),
		],
	};
}

/**
 * Wrap pi's own local bash backend instead of reimplementing it. Delegation
 * keeps parity with the built-in bash tool: env/session variables (PI_*),
 * the ~/.pi/agent/bin PATH entry, timeout and abort handling, and detached
 * child tracking so process trees die with pi.
 */
function createSandboxedBashOps(): BashOperations {
	const local = createLocalBashOperations();
	return {
		async exec(command, cwd, options) {
			const wrapped = await SandboxManager.wrapWithSandbox(command);
			return local.exec(wrapped, cwd, options);
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("no-sandbox", {
		description: "Disable OS-level sandboxing for bash commands",
		type: "boolean",
		default: false,
	});

	const projectCwd = process.cwd();
	const hostBash = createBashTool(projectCwd);

	/**
	 * Aggregate sandbox state — one concept instead of loose travelling flags
	 * (review: Data Clumps). `tool`/`ops` are built once per initialization and
	 * reused by both the bash tool override and the user_bash hook.
	 */
	const sandbox = {
		enabled: false,
		initialized: false,
		initError: null as string | null,
		gitDirs: [] as string[],
		ops: null as BashOperations | null,
		tool: null as ReturnType<typeof createBashTool> | null,
	};

	/**
	 * In-flight initialization, if any. Bash calls that arrive while the
	 * session is still starting up await this instead of racing past it to
	 * unsandboxed execution.
	 */
	let initInFlight: Promise<void> | null = null;

	function refreshStatus(ctx: ExtensionContext): void {
		// Dim color matches the surrounding UI chrome (footer lines) so the
		// status reads at a glance without grabbing attention.
		const text = sandbox.enabled
			? "sandbox on"
			: sandbox.initError
				? "sandbox off (unavailable)"
				: "sandbox off";
		try {
			ctx.ui.setWidget(
				"sandbox",
				(_tui, theme) => new Text(theme.fg("dim", text), 1, 0),
				{ placement: "aboveEditor" },
			);
		} catch {
			// Widgets are unavailable in non-interactive mode
		}
	}

	async function enableSandbox(ctx: ExtensionContext): Promise<void> {
		const platform = process.platform;
		if (platform !== "darwin" && platform !== "linux") {
			sandbox.initError = `unsupported on ${platform}`;
			ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			refreshStatus(ctx);
			return;
		}

		// Config is read fresh on every enable; re-enabling within a session
		// resets the runtime so config edits take effect (review: stale config).
		const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());

		try {
			if (sandbox.initialized) {
				try {
					await SandboxManager.reset();
				} catch {
					// A failed reset of stale runtime state is not fatal —
					// initialize() below replaces whatever is left.
				}
			}
			sandbox.gitDirs = detectExternalGitDirs(ctx.cwd);
			await SandboxManager.initialize({
				network: config.network,
				filesystem: hardenedFilesystem(config, ctx.cwd, sandbox.gitDirs),
			});
			sandbox.initialized = true;
			sandbox.ops = createSandboxedBashOps();
			sandbox.tool = createBashTool(projectCwd, { operations: sandbox.ops });
		} catch (err) {
			sandbox.enabled = false;
			sandbox.initialized = false;
			sandbox.ops = null;
			sandbox.tool = null;
			sandbox.initError = err instanceof Error ? err.message : String(err);
			ctx.ui.notify(`Sandbox initialization failed: ${sandbox.initError}`, "error");
			refreshStatus(ctx);
			return;
		}

		sandbox.initError = null;
		sandbox.enabled = true;
		refreshStatus(ctx);
	}

	/** Start (or restart) the sandbox; never rejects, so awaiting callers are safe. */
	function startEnable(ctx: ExtensionContext): Promise<void> {
		const pending = enableSandbox(ctx).catch(() => {
			// enableSandbox reports its own errors; this only guards the
			// initInFlight contract.
		});
		initInFlight = pending;
		void pending.then(() => {
			if (initInFlight === pending) initInFlight = null;
		});
		return pending;
	}

	async function disableSandbox(ctx: ExtensionContext): Promise<void> {
		sandbox.enabled = false;
		sandbox.gitDirs = [];
		if (sandbox.initialized) {
			sandbox.initialized = false;
			sandbox.ops = null;
			sandbox.tool = null;
			// Tear the runtime down rather than leaving the host-side proxy
			// and bridges listening for the rest of the session. Commands
			// already wrapped with the old proxy credentials fail closed.
			try {
				await SandboxManager.reset();
			} catch {
				// Ignore cleanup errors
			}
		}
		refreshStatus(ctx);
	}

	pi.registerTool({
		...hostBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, ctx) {
			if (initInFlight) await initInFlight;

			if (sandbox.enabled && sandbox.tool) {
				return sandbox.tool.execute(id, params, signal, onUpdate, ctx);
			}
			// ctx is forwarded on the fallback path too, so unsandboxed
			// execution still lands in the session cwd with session env.
			return hostBash.execute(id, params, signal, onUpdate, ctx);
		},
	});

	pi.on("user_bash", () => {
		if (!sandbox.enabled || !sandbox.ops) return;
		return { operations: sandbox.ops };
	});

	pi.on("session_start", async (_event, ctx) => {
		const noSandbox = pi.getFlag("no-sandbox") as boolean;

		if (noSandbox) {
			sandbox.enabled = false;
			refreshStatus(ctx);
			return;
		}

		const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());

		if (!config.enabled) {
			sandbox.enabled = false;
			refreshStatus(ctx);
			return;
		}

		await startEnable(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			ctx.ui.setWidget("sandbox", undefined, { placement: "aboveEditor" });
		} catch {
			// Widgets are unavailable in non-interactive mode
		}

		if (sandbox.initialized) {
			try {
				await SandboxManager.reset();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox status; `on`/`off` toggles it for this session",
		getArgumentCompletions: (prefix) =>
			["on", "off"]
				.filter((v) => v.startsWith(prefix.toLowerCase()))
				.map((v) => ({ value: v, label: v })),
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "on") {
				await startEnable(ctx);
				return;
			}
			if (action === "off") {
				await disableSandbox(ctx);
				return;
			}
			if (action) {
				ctx.ui.notify(
					`Unknown argument "${args.trim()}" — usage: /sandbox [on|off]`,
					"error",
				);
				return;
			}

			const trusted = ctx.isProjectTrusted();
			const config = loadConfig(ctx.cwd, trusted);
			const state = sandbox.enabled
				? "on"
				: sandbox.initError
					? `off (${sandbox.initError})`
					: "off";
			const fmt = (list?: string[]) => list?.join(", ") || "(none)";
			const lines = [
				`Sandbox: ${state} (toggle: /sandbox on | /sandbox off)`,
				...(trusted || !existsSync(projectConfigPath(ctx.cwd))
					? []
					: ["Project config ignored (project is not trusted)"]),
				"",
				"Network:",
				`  Allowed: ${fmt(config.network?.allowedDomains)}`,
				`  Denied: ${fmt(config.network?.deniedDomains)}`,
				"",
				"Filesystem:",
				`  Deny Read: ${fmt(config.filesystem?.denyRead)}`,
				`  Allow Write: ${fmt(config.filesystem?.allowWrite)}`,
				`  Deny Write: ${fmt(config.filesystem?.denyWrite)}`,
				...(sandbox.gitDirs.length
					? [`Git metadata (auto-allowed): ${sandbox.gitDirs.join(", ")}`]
					: []),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
