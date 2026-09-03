---
"@pi-spice/minimal-subagents": minor
"@pi-spice/all": minor
---

Restyle the `spawn_agents` transcript display: a one-line call header, then one indented block per agent — status, duration, tool count, tokens/cost, model when the call mixes models, and the task while queued, latest activity while running, or result preview once finished — closed by a call-total summary line and a separate hint line. Expanded view shows final outputs only. Transcript lines are truncated by display width — long commands and CJK text no longer break the layout.
