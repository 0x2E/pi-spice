---
"@pi-spice/minimal-subagents": patch
"@pi-spice/all": patch
---

Fix the `spawn_agents` block losing its background tint after truncation: pi's `truncateToWidth` wraps the appended ellipsis in bare `\x1b[0m` resets, which also cleared the tool block's background for the rest of each padded row — stripped lines now keep their color to the end of the line, with scoped `\x1b[22m\x1b[39m` closes re-emitted so a truncation inside a bold agent name no longer leaks bold onto the following lines. Lines are also truncated to the block's real content width (terminal width minus the box padding) so long rows no longer re-wrap into 1-2 character orphan rows, and the summary/hint status line is separated from the per-agent rows by a blank line.
