---
"@pi-spice/minimal-subagents": minor
---

`spawn_agents` now takes one flat agent spec (`task`, `name`, `systemPrompt`, `model`, `thinking`, `tools`) instead of an `agents` array — parallel work is several calls in one assistant message, which pi already runs concurrently. The four-child limit is shared across calls, so extra calls queue instead of multiplying processes, the transcript row is now two lines — `subagent <name>` followed by its status, with the task underneath, instead of a `spawn_agents (N agents)` header with the name repeated twice, an agent waiting for a child slot reads `queued` instead of `running` (the phase is now explicit rather than inferred from "no messages yet", and the clock starts with the process so queue time is not charged to the agent), and the `alt+a` panel keeps one tab per agent across the session (most recent eight) instead of showing only the last call.

Field wording now states the action instead of a default: `Omit to inherit the parent session's model` / `… level` / `Omit for the child's configured tool set` (with grep, find and ls called out as opt-in, since the default set does not include them). Models were filling `model: "inherit"` when they wanted inheritance, which spawned a child with an unresolvable `--model`; an omitted field is now the only documented way to inherit.
