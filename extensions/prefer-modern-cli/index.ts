/**
 * prefer-modern-cli — prefer `rg`/`fd` over `grep`/`find` in hand-written bash search commands
 *
 * Probes each tool (managed `~/.pi/agent/bin`, then PATH) once per instance.
 * Available tools get one preference line in the system prompt when bash is
 * active. Session start fires a one-line availability badge. Missing tools
 * are skipped — a preference for a missing binary would only fail.
 *
 * pi's built-in `grep`/`find` tools are already ripgrep/fd-backed; this covers
 * the gap where the model writes its own search inside bash. Nothing is
 * blocked or rewritten.
 *
 * Install: pi install npm:@pi-spice/prefer-modern-cli
 * Quick test: pi -e ./extensions/prefer-modern-cli
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

/** Tool pairs: modern replacement vs. legacy command it supersedes. */
const TOOLS = [
	{
		name: "rg",
		prompt: "Prefer `rg` over `grep`, `egrep`, or `ack` in bash commands.",
	},
	{
		name: "fd",
		prompt: "Prefer `fd` over `find` in bash commands.",
	},
] as const;

/** pi downloads rg/fd into its managed bin dir and prepends it to the bash tool's PATH. */
function managedBin(name: string): string {
	return join(getAgentDir(), "bin", process.platform === "win32" ? `${name}.exe` : name);
}

function promptSection(available: Set<string>): string | undefined {
	const bullets = TOOLS.filter((tool) => available.has(tool.name)).map((tool) => tool.prompt);
	if (bullets.length === 0) return undefined;
	return `\n\n## CLI Tool Preferences\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n`;
}

export default function preferModernCli(pi: ExtensionAPI) {
	// The bash tool's PATH cannot change under a running pi, so check once per
	// extension instance; /reload, /new, /resume and /fork rebuild and re-check.
	let check: Promise<Set<string>> | undefined;
	const availableTools = () =>
		(check ??= (async () => {
			const available = new Set<string>();
			for (const { name } of TOOLS) {
				// The managed copy is only on the bash tool's PATH, not pi's own,
				// so probe it by absolute path; fall back to the system PATH.
				for (const cmd of [managedBin(name), name]) {
					try {
						const result = await pi.exec(cmd, ["--version"], { timeout: 5000 });
						if (result.code === 0) {
							available.add(name);
							break;
						}
					} catch {
						// spawn error or timeout — try the next candidate
					}
				}
			}
			return available;
		})());

	// One-shot notice when a session starts (startup/new/resume/fork/reload all
	// count): a self-contained status badge on one line. "info" renders as a
	// dim transcript line; embedded theme colors override that dim base.
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const available = await availableTools();
		const t = ctx.ui.theme;
		const marks = TOOLS.map(
			(tool) => `${t.fg("dim", tool.name)} ${available.has(tool.name) ? t.fg("success", "✓") : t.fg("error", "✗")}`,
		).join(t.fg("dim", " · "));
		ctx.ui.notify(`${t.fg("accent", "◆ prefer-modern-cli")}  ${marks}`, "info");
	});

	pi.on("before_agent_start", async (event) => {
		// Only relevant when the bash tool is active — otherwise the tool choice
		// never comes up in a bash command. An omitted list means pi's defaults,
		// which include bash.
		const selected = event.systemPromptOptions.selectedTools;
		const hasBash = selected?.includes("bash") ?? pi.getActiveTools().includes("bash");
		if (!hasBash) return;

		const section = promptSection(await availableTools());
		if (!section) return undefined;
		return { systemPrompt: event.systemPrompt + section };
	});
}
