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
 *   - ~/.pi/agent/extensions/sandbox.json
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
	const globalConfigPath = join(getAgentDir(), "extensions", "sandbox.json");

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

	let sandboxEnabled = false;
	let sandboxInitialized = false;
	let initError: string | null = null;

	function refreshStatus(ctx: ExtensionContext): void {
		try {
			ctx.ui.setWidget(
				"sandbox",
				[sandboxEnabled ? "sandbox on" : "sandbox off"],
				{ placement: "aboveEditor" },
			);
		} catch {
			// Widgets are unavailable in non-interactive mode
		}
	}

	async function enableSandbox(ctx: ExtensionContext): Promise<void> {
		const platform = process.platform;
		if (platform !== "darwin" && platform !== "linux") {
			initError = `unsupported on ${platform}`;
			ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			refreshStatus(ctx);
			return;
		}

		const config = loadConfig(ctx.cwd);

		if (!sandboxInitialized) {
			try {
				await SandboxManager.initialize({
					network: config.network,
					filesystem: config.filesystem,
				});
				sandboxInitialized = true;
			} catch (err) {
				initError = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Sandbox initialization failed: ${initError}`, "error");
				refreshStatus(ctx);
				return;
			}
		}

		initError = null;
		sandboxEnabled = true;
		refreshStatus(ctx);
	}

	function disableSandbox(ctx: ExtensionContext): void {
		sandboxEnabled = false;
		refreshStatus(ctx);
	}

	pi.registerTool({
		...hostBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandboxEnabled || !sandboxInitialized) {
				return hostBash.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(projectCwd, {
				operations: createSandboxedBashOps(),
			});
			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", () => {
		if (!sandboxEnabled || !sandboxInitialized) return;
		return { operations: createSandboxedBashOps() };
	});

	pi.on("session_start", async (_event, ctx) => {
		const noSandbox = pi.getFlag("no-sandbox") as boolean;

		if (noSandbox) {
			sandboxEnabled = false;
			refreshStatus(ctx);
			return;
		}

		const config = loadConfig(ctx.cwd);

		if (!config.enabled) {
			sandboxEnabled = false;
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

		if (sandboxInitialized) {
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
			const state = sandboxEnabled
				? "on"
				: initError
					? `off (${initError})`
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
