/**
 * prefer-ripgrep — nudge the model to use `rg` instead of `grep` in bash commands
 *
 * Note: pi's built-in `grep` tool is already backed by ripgrep (spawns
 * `rg --json ...`, respects .gitignore), so it needs no replacement. This
 * extension does one thing only: when the model hand-writes a search command
 * in bash, prefer `rg`.
 *
 * Install: pi install npm:@pi-spice/prefer-ripgrep
 * Quick test: pi -e ./extensions/prefer-ripgrep
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function preferRipgrep(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		// Only relevant when the bash tool is active — otherwise the grep-vs-rg
		// choice never comes up in a bash command.
		const hasBash = event.systemPromptOptions.selectedTools?.includes("bash") ?? false;
		if (!hasBash) return;

		return {
			systemPrompt:
				event.systemPrompt +
				`

## Search Command Preference

- When running searches in bash commands, use \`rg\` (ripgrep) instead of \`grep\`, \`egrep\`, or \`ack\`.
  Examples: \`rg pattern\`, \`rg -i pattern --glob '*.ts'\`, \`rg -l pattern src/\`.
- The built-in \`grep\` tool is already backed by ripgrep and remains the preferred tool for content searches.
`,
		};
	});
}
