---
"@pi-spice/minimal-subagents": minor
"@pi-spice/all": minor
---

Restyle the `spawn_agents` transcript display: a one-line call header, then one block per agent — status, duration, tool count, and the first line of the task as a stable identifier, with a third line for live activity while running. Call totals (tokens/cost) sit on a summary line after completion; the hint line is running-only. Expanded view shows final outputs only. Transcript lines are truncated by display width — long commands and CJK text no longer break the layout.
