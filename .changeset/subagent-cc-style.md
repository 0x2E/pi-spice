---
"@pi-spice/minimal-subagents": minor
"@pi-spice/all": minor
---

Restyle the `spawn_agents` transcript display: a one-line call header over a labeled divider (call-level progress/totals) and one block per agent — status, duration, tool count, tokens/cost, model when the call mixes models, and the task while queued, latest activity while running, or result preview once finished. Expanded view shows final outputs only. Transcript lines are truncated by display width — long commands and CJK text no longer break the layout.
