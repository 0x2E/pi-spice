---
"@pi-spice/minimal-subagents": minor
"@pi-spice/all": minor
---

Restyle the `spawn_agents` transcript display: a `✻`/`·`/`✓`/`✗` tree with per-agent duration and tool counts, an explicit first-line result preview, a two-liner for single-agent calls, and a cleaner expanded view (final outputs only). Transcript lines are now truncated by display width — long commands and CJK text no longer break the one-line-per-agent layout.
