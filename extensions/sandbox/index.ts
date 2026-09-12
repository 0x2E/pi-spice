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
 * or "enabled": false in config. Status bar shows the current state.
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

import { spawn } from "node:child_process";
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
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					reject(err);
				});

				const onAbort = () => {
					if (child.pid) {
						try {
							process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}
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

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let sandboxEnabled = false;
	let sandboxInitialized = false;
	let initError: string | null = null;
	let lastConfig: SandboxConfig = DEFAULT_CONFIG;

	function refreshStatus(ctx: ExtensionContext): void {
		try {
			if (sandboxEnabled) {
				const networkCount = lastConfig.network?.allowedDomains?.length ?? 0;
				const writeCount = lastConfig.filesystem?.allowWrite?.length ?? 0;
				ctx.ui.setStatus(
					"sandbox",
					ctx.ui.theme.fg(
						"success",
						`🔒 sandbox: on · ${networkCount} domains · ${writeCount} write paths`,
					),
				);
			} else if (initError) {
				ctx.ui.setStatus(
					"sandbox",
					ctx.ui.theme.fg("warning", `🔒 sandbox: off (${initError})`),
				);
			} else {
				ctx.ui.setStatus(
					"sandbox",
					ctx.ui.theme.fg("muted", "🔒 sandbox: off"),
				);
			}
		} catch {
			// Status bar is unavailable in non-interactive mode
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
		lastConfig = config;
		sandboxEnabled = true;
		refreshStatus(ctx);
		ctx.ui.notify("Sandbox enabled", "info");
	}

	function disableSandbox(ctx: ExtensionContext): void {
		sandboxEnabled = false;
		refreshStatus(ctx);
		ctx.ui.notify("Sandbox disabled — bash now runs unsandboxed", "warning");
	}

	pi.registerTool({
		...localBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandboxEnabled || !sandboxInitialized) {
				return localBash.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(localCwd, {
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
			ctx.ui.notify(
				"Sandbox disabled via --no-sandbox (toggle with /sandbox on)",
				"warning",
			);
			refreshStatus(ctx);
			return;
		}

		const config = loadConfig(ctx.cwd);

		if (!config.enabled) {
			sandboxEnabled = false;
			ctx.ui.notify(
				"Sandbox disabled via config (toggle with /sandbox on)",
				"info",
			);
			refreshStatus(ctx);
			return;
		}

		await enableSandbox(ctx);
	});

	pi.on("session_shutdown", async () => {
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
			const lines = [
				`Sandbox: ${state} (toggle: /sandbox on | /sandbox off)`,
				"",
				"Network:",
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem:",
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
