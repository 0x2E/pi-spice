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
 * Toggle: `/sandbox on` / `/sandbox off` at runtime, or `--no-sandbox` flag,
 * or "enabled": false in config. A single status line ("sandbox on"/"sandbox off")
 * is rendered above the input box.
 * Config files (project overrides global):
 *   - ~/.pi/agent/sandbox.json
 *   - <project>/.pi/sandbox.json
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
 * error notification. Fail-closed behavior is a planned iteration.
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

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
		denyWrite: [".env", ".env.*", "*.pem", "*.key"],
	},
};

function loadConfig(cwd: string): SandboxConfig {
	const projectConfigPath = join(cwd, CONFIG_DIR_NAME, "sandbox.json");
	const globalConfigPath = join(getAgentDir(), "sandbox.json");

	let globalConfig: Partial<SandboxConfig> = {};
	let projectConfig: Partial<SandboxConfig> = {};

	if (existsSync(globalConfigPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
		}
	}

	if (existsSync(projectConfigPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
		}
	}

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

/** Kill a detached child's whole process group, falling back to the child alone. */
function killGroup(child: ChildProcess): void {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

function createSandboxedBashOps(): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

			return new Promise((resolve, reject) => {
				const child = spawn("bash", ["-c", wrappedCommand], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;

				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						killGroup(child);
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					reject(err);
				});

				const onAbort = () => {
					killGroup(child);
				};

				signal?.addEventListener("abort", onAbort, { once: true });

				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);

					if (signal?.aborted) {
						reject(new Error("aborted"));
					} else if (timedOut) {
						reject(new Error(`timeout:${timeout}`));
					} else {
						resolve({ exitCode: code });
					}
				});
			});
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
		ops: null as BashOperations | null,
		tool: null as ReturnType<typeof createBashTool> | null,
	};

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
		const config = loadConfig(ctx.cwd);

		try {
			if (sandbox.initialized) {
				await SandboxManager.reset();
			}
			await SandboxManager.initialize({
				network: config.network,
				filesystem: config.filesystem,
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

	function disableSandbox(ctx: ExtensionContext): void {
		sandbox.enabled = false;
		refreshStatus(ctx);
	}

	pi.registerTool({
		...hostBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandbox.enabled || !sandbox.tool) {
				return hostBash.execute(id, params, signal, onUpdate);
			}
			return sandbox.tool.execute(id, params, signal, onUpdate);
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

		const config = loadConfig(ctx.cwd);

		if (!config.enabled) {
			sandbox.enabled = false;
			refreshStatus(ctx);
			return;
		}

		await enableSandbox(ctx);
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
				await enableSandbox(ctx);
				return;
			}
			if (action === "off") {
				disableSandbox(ctx);
				return;
			}
			if (action) {
				ctx.ui.notify(
					`Unknown argument "${args.trim()}" — usage: /sandbox [on|off]`,
					"error",
				);
				return;
			}

			const config = loadConfig(ctx.cwd);
			const state = sandbox.enabled
				? "on"
				: sandbox.initError
					? `off (${sandbox.initError})`
					: "off";
			const fmt = (list?: string[]) => list?.join(", ") || "(none)";
			const lines = [
				`Sandbox: ${state} (toggle: /sandbox on | /sandbox off)`,
				"",
				"Network:",
				`  Allowed: ${fmt(config.network?.allowedDomains)}`,
				`  Denied: ${fmt(config.network?.deniedDomains)}`,
				"",
				"Filesystem:",
				`  Deny Read: ${fmt(config.filesystem?.denyRead)}`,
				`  Allow Write: ${fmt(config.filesystem?.allowWrite)}`,
				`  Deny Write: ${fmt(config.filesystem?.denyWrite)}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
