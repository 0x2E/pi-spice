---
"@pi-spice/minimal-subagents": minor
"@pi-spice/all": minor
---

Restyle the `spawn_agents` transcript display: a `✻`/`·`/`✓`/`✗` tree of per-agent blocks on `├`/`└` connectors — each with a quantified header (duration, tool count, tokens/cost, model when the call mixes models) over the latest activity or result preview, plus a two-liner for single-agent calls and a cleaner expanded view (final outputs only). Transcript lines are now truncated by display width — long commands and CJK text no longer break the layout.
