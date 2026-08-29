# @pi-spice/minimal-subagents

One tool, `spawn_agents`: describe sub-agents inline, run them in parallel, block until every one finishes. No predefined agent files, no orchestration, no nesting. Each sub-agent is an isolated `pi` process with its own context window; the child-process machinery is adapted from pi's official subagent example.

## Install

```bash
pi install npm:@pi-spice/minimal-subagents
```

Quick test from this repo: `pi -e ./extensions/minimal-subagents`

## How it works

`spawn_agents({ agents: [spec...] })` — a single task is an array of one; up to 8 per call, 4 running at a time.

| Field | Required | Default |
|---|---|---|
| `task` | ✓ | — |
| `systemPrompt` | — | child default; role/constraints go here, not the assignment |
| `model` | — | inherit the parent session's model |
| `thinking` | — | inherit the parent session's thinking level (`off`…`max`) |
| `tools` | — | child default tools; e.g. `["read","grep","find","ls"]` for read-only scouts |
| `name` | — | `agent-<index>` |

- **Failures don't cancel siblings** — every agent runs to completion; each result is a `### [name] completed/failed` section with the agent's final output (50 KB cap; full transcripts stay in the tool details). `isError` only when all fail.
- **Live progress** — a one-line-per-agent scoreboard in the transcript (status, turns, latest activity); `alt+a` for the live detail panel, `Ctrl+O` after completion for the full archive.
- **Abort** returns partial results — finished agents keep their output, the rest are marked `aborted`; the whole child process group is killed (`SIGTERM`, then `SIGKILL` after 5 s).

## Details panel (`alt+a`)

- One tab per sub-agent (`←`/`→` or `1`-`8`; the tab bar compacts automatically on narrow panels), labeled with name and live status (⏳/✓/✗).
- Each tab is the agent's full timeline: task, tool calls, tool-result previews (first 10 lines), assistant output rendered as markdown, usage. Thinking is not shown.
- Terminal-style scrolling: `↑/↓`, `PgUp/PgDn`, `Home`/`g`, `End`/`G`, mouse wheel — pinned to the bottom while following new output, scrolling up pauses, `End` resumes. `Esc` closes.
- Shows the latest call only. Two platform limits: it is an overlay (the transcript is covered, not reflowed), and mouse wheel works only under `--tui-mode fullscreen` — the only mode where pi enables terminal mouse reporting.

## No nesting

Children run with `PI_SUBAGENTS_CHILD=1` (the extension skips tool registration when it sees it) and are launched with `--exclude-tools spawn_agents` as a backstop. This is a guard, not a sandbox: a sub-agent with `bash` can still start arbitrary processes and work around both layers (e.g. `env -u PI_SUBAGENTS_CHILD pi ...`) — use `tools` restrictions or a container for hard isolation. Side effect: exporting `PI_SUBAGENTS_CHILD=1` in your own shell hides `spawn_agents` from your sessions.
