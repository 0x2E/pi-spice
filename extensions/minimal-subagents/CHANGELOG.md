# @pi-spice/minimal-subagents

## 0.3.0

### Minor Changes

- 0cf7d69: `spawn_agents` now takes one flat agent spec (`task`, `name`, `systemPrompt`, `model`, `thinking`, `tools`) instead of an `agents` array — parallel work is several calls in one assistant message, which pi already runs concurrently. The four-child limit is shared across calls, so extra calls queue instead of multiplying processes, the transcript row is now two lines — `subagent <name>` followed by its status, with the task underneath, instead of a `spawn_agents (N agents)` header with the name repeated twice, an agent waiting for a child slot reads `queued` instead of `running` (the phase is now explicit rather than inferred from "no messages yet", and the clock starts with the process so queue time is not charged to the agent), and the `alt+a` panel keeps one tab per agent across the session (most recent eight) instead of showing only the last call.
  
  Field wording now states the action instead of a default: `Omit to inherit the parent session's model` / `… level` / `Omit for the child's configured tool set` (with grep, find and ls called out as opt-in, since the default set does not include them). Models were filling `model: "inherit"` when they wanted inheritance, which spawned a child with an unresolvable `--model`; an omitted field is now the only documented way to inherit.

### Patch Changes

- ca49ad1: Documentation and comment cleanup, including shorter package descriptions. No behavior change.

## 0.2.1

### Patch Changes

- 7ca08d4: Fix the details panel ignoring keys on terminals that negotiated the kitty keyboard protocol: match Esc/arrows/Home/End/number keys via `matchesKey` instead of raw escape-sequence bytes, so Esc closes and arrows switch tabs in every encoding.
- dee1bdd: Fix the `spawn_agents` block losing its background tint after truncation: pi's `truncateToWidth` wraps the appended ellipsis in bare `\x1b[0m` resets, which also cleared the tool block's background for the rest of each padded row — stripped lines now keep their color to the end of the line, with scoped `\x1b[22m\x1b[39m` closes re-emitted so a truncation inside a bold agent name no longer leaks bold onto the following lines. Lines are also truncated to the block's real content width (terminal width minus the box padding) so long rows no longer re-wrap into 1-2 character orphan rows, and the summary/hint status line is separated from the per-agent rows by a blank line.

## 0.2.0

### Minor Changes

- 349aa7f: Restyle the `spawn_agents` transcript display: a one-line call header, then one block per agent — status, duration, tool count, and the first line of the task as a stable identifier, with a third line for live activity while running. Call totals (tokens/cost) sit on a summary line after completion; the hint line is running-only. Expanded view shows final outputs only. Transcript lines are truncated by display width — long commands and CJK text no longer break the layout.

## 0.1.1

### Patch Changes

- 245d41f: Details panel: alt+a now toggles (also closes an open panel); panel data is seeded the moment spawn_agents starts, so alt+a works during the child-startup window and after an interrupt instead of reporting "no data"; alt+a with no run at all shows pi's notify; panel content gets inner padding and footer hints that fit narrow panels.
