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

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
			"  Examples: `fd --glob '*.ts'`, `fd -e json`, `fd -H pattern`.",
	},
] as const;

/** pi downloads rg/fd into its managed bin dir and prepends it to the bash tool's PATH. */
function managedBin(name: string): string {
	return join(getAgentDir(), "bin", process.platform === "win32" ? `${name}.exe` : name);
}

/** Yellow background, black bold text — readable on light and dark themes. */
const warningBg = (s: string) => `\x1b[43;30;1m${s}\x1b[0m`;

const missingOf = (available: Set<string>): string[] =>
	TOOLS.map((tool) => tool.name).filter((name) => !available.has(name));

function promptSection(available: Set<string>, selectedTools: string[] | undefined): string | undefined {
	const bullets = TOOLS.filter((tool) => available.has(tool.name)).map((tool) => tool.guideline);
	if (bullets.length === 0) return undefined;
	bullets.push("- `rg` and `fd` are fast and respect .gitignore.");
	// Only point at built-in tools that are actually active in this session.
	const builtIns = (["grep", "find"] as const).filter((name) => selectedTools?.includes(name));
	if (builtIns.length > 0) {
		bullets.push(`- The built-in \`${builtIns.join("`/`")}\` tool${builtIns.length > 1 ? "s" : ""} remain${builtIns.length > 1 ? "" : "s"} the preferred tools for searches.`);
	}
	return `\n\n## Search Command Preference\n\n${bullets.join("\n")}\n`;
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

	// One banner per session file: the entry persists, so resumes, forks and
	// reloads keep the original instead of stacking another one.
	let warned = false;
	const warnOnce = (missing: string[]) => {
		if (warned || missing.length === 0) return;
		warned = true;
		pi.appendEntry(WARNING_TYPE, { missing, timestamp: Date.now() });
	};

	// Rendered inside the transcript (TUI mode only); does not reach the LLM.
	pi.registerEntryRenderer(WARNING_TYPE, (entry: { data?: { missing?: string[] } }) => {
		const missing = entry.data?.missing ?? TOOLS.map((tool) => tool.name);
		return new Text(
			`⚠ prefer-modern-cli: ${missing.join(", ")} not found — ${missing.length > 1 ? "their guidelines are" : "its guideline is"} skipped.`,
			1,
			0,
			warningBg,
		);
	});

	// Earliest possible moment: entering the agent with bash already active.
	pi.on("session_start", async (_event, ctx) => {
		warned = ctx.sessionManager
			.getEntries()
			.some((entry) => entry.type === "custom" && entry.customType === WARNING_TYPE);
		if (warned) return;
		if (!pi.getActiveTools().includes("bash")) return;
		warnOnce(missingOf(await availableTools()));
	});

	pi.on("before_agent_start", async (event) => {
		// Only relevant when the bash tool is active — otherwise the tool choice
		// never comes up in a bash command. An omitted list means pi's defaults,
		// which include bash.
		const selected = event.systemPromptOptions.selectedTools;
		const hasBash = selected?.includes("bash") ?? pi.getActiveTools().includes("bash");
		if (!hasBash) return;

		const available = await availableTools();
		warnOnce(missingOf(available));

		const section = promptSection(available, selected);
		if (!section) return undefined;
		return { systemPrompt: event.systemPrompt + section };
	});
}
