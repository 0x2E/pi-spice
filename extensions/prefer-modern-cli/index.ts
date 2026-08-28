/**
 * prefer-modern-cli — nudge the model to use modern CLI tools (`rg`, `fd`) in bash commands
 *
 * pi's built-in `grep`/`find` tools are already ripgrep/fd-backed and need no
 * replacement; this extension covers the gap where the model hand-writes a
 * search command inside a bash invocation. It first verifies each tool is
 * actually usable in bash (pi's managed `~/.pi/agent/bin` copies count — that
 * directory is on the bash tool's PATH). Missing tools get a yellow warning
 * banner instead of a preference that would only fail.
 *
 * Install: pi install npm:@pi-spice/prefer-modern-cli
 * Quick test: pi -e ./extensions/prefer-modern-cli
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";

const WARNING_TYPE = "prefer-modern-cli-warning";

/** Tool pairs: modern replacement vs. legacy command it supersedes. */
const TOOLS = [
	{
		name: "rg",
		guideline:
			"- For content searches in bash commands, use `rg` (ripgrep) instead of `grep`, `egrep`, or `ack`.\n" +
			"  Examples: `rg pattern`, `rg -i pattern --glob '*.ts'`, `rg -l pattern src/`.",
	},
	{
		name: "fd",
		guideline:
			"- For file-name searches in bash commands, use `fd` instead of `find`.\n" +
			"  Examples: `fd '*.ts'`, `fd --extension json`, `fd -H pattern`.",
	},
] as const;

/** pi downloads rg/fd into its managed bin dir and prepends it to the bash tool's PATH. */
function managedBin(name: string): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR
		? process.env.PI_CODING_AGENT_DIR.replace(/^~(?=\/|$)/, homedir())
		: join(homedir(), ".pi", "agent");
	return join(agentDir, "bin", process.platform === "win32" ? `${name}.exe` : name);
}

/** Yellow background, black bold text — readable on light and dark themes. */
const warningBg = (s: string) => `\x1b[43;30;1m${s}\x1b[0m`;

function promptSection(available: Set<string>): string | undefined {
	const bullets = TOOLS.filter((tool) => available.has(tool.name)).map((tool) => tool.guideline);
	if (bullets.length === 0) return undefined;
	bullets.push(
		"- These tools are fast and respect .gitignore. The built-in `grep`/`find` tools remain the preferred tools for searches.",
	);
	return `\n\n## Search Command Preference\n\n${bullets.join("\n")}\n`;
}

export default function preferModernCli(pi: ExtensionAPI) {
	// The bash tool's PATH cannot change under a running pi, so check once.
	let check: Promise<Set<string>> | undefined;
	const availableTools = () =>
		(check ??= (async () => {
			const available = new Set<string>();
			for (const { name } of TOOLS) {
				if (existsSync(managedBin(name))) {
					available.add(name);
					continue;
				}
				try {
					const result = await pi.exec(name, ["--version"], { timeout: 5000 });
					if (result.code === 0) available.add(name);
				} catch {
					// spawn error or timeout — treat as missing
				}
			}
			return available;
		})());

	// One banner per session file: the entry persists, so resumes, forks and
	// reloads keep the original instead of stacking another one.
	let warned = false;
	const warnOnce = (missing: string[]) => {
		if (warned || missing.length === 0) return;
		warned = true;
		pi.appendEntry(WARNING_TYPE, { missing, timestamp: Date.now() });
	};

	// Rendered inside the transcript (TUI mode only); does not reach the LLM.
	pi.registerEntryRenderer(WARNING_TYPE, (entry: { data?: { missing?: string[] } }) =>
		new Text(
			`⚠ prefer-modern-cli: ${(entry.data?.missing ?? TOOLS.map((t) => t.name)).join(", ")} not found — preference disabled.`,
			1,
			0,
			warningBg,
		),
	);

	// Earliest possible moment: entering the agent with bash already active.
	pi.on("session_start", async (_event, ctx) => {
		warned = ctx.sessionManager
			.getEntries()
			.some((entry) => entry.type === "custom" && entry.customType === WARNING_TYPE);
		if (warned) return;
		if (!pi.getActiveTools().includes("bash")) return;
		const available = await availableTools();
		warnOnce(TOOLS.map((t) => t.name).filter((name) => !available.has(name)));
	});

	pi.on("before_agent_start", async (event) => {
		// Only relevant when the bash tool is active — otherwise the tool choice
		// never comes up in a bash command.
		const hasBash = event.systemPromptOptions.selectedTools?.includes("bash") ?? false;
		if (!hasBash) return;

		const available = await availableTools();
		warnOnce(TOOLS.map((t) => t.name).filter((name) => !available.has(name)));

		const section = promptSection(available);
		if (!section) return undefined;
		return { systemPrompt: event.systemPrompt + section };
	});
}
