# minimal-subagents

Create sub-agents dynamically and run them in parallel with one blocking tool call. No predefined agent files, no orchestration, no nesting — each sub-agent is described inline, spawned as an isolated `pi` process, and the parent waits until every one of them finishes.

Forked from the official pi example extension [`examples/extensions/subagent`](https://github.com/earendil-works/pi) (MIT), stripped to its minimal core.

## Install

```bash
pi install npm:@pi-spice/minimal-subagents
```

Quick test from this repo: `pi -e ./extensions/minimal-subagents`

## How it works

The model calls a single tool, `spawn_agents`, with an array of agent specs (a single task is an array of one):

| Field | Required | Default |
|---|---|---|
| `task` | ✓ | — |
| `systemPrompt` | — | child default; passed via `--append-system-prompt` (role/constraints go here, not the assignment) |
| `model` | — | inherit the parent session's model |
| `thinking` | — | inherit the parent session's thinking level (`off`…`max`) |
| `tools` | — | child default tools; e.g. `["read","grep","find","ls"]` for read-only scouts |
| `name` | — | `agent-<index>`, used for display and result labels |

Behavior:

- **Parallel, blocking** — up to 8 agents per call, at most 4 running at once; the tool returns when all finish. Each result is a `### [name] completed/failed` section with the agent's final output (capped at 50 KB per agent; the full transcript stays in the tool details).
- **Failures don't cancel siblings** — every agent runs to completion; per-agent status is reported. The tool marks `isError` only when *all* agents failed.
- **Live progress** — sub-agent tool calls and output stream into the parent's TUI while the call is running (expand with `Ctrl+O`).
- **Isolated context** — each sub-agent is a separate `pi -p --no-session` process with its own context window; it shares the parent's working directory and project context.
- **Abort** — interrupting the parent kills sub-agents (`SIGTERM`, then `SIGKILL` after 5 s).

## Details panel (alt+a)

Press `alt+a` any time to open a right-side overlay panel for the latest `spawn_agents` call:

- One tab per sub-agent (`←`/`→` or `1`-`8` to switch), labeled with name and live status (⏳/✓/✗).
- Each tab is the agent's **full timeline** from task to current state: tool calls, tool-result previews (first 10 lines, dimmed), assistant output rendered as markdown, usage stats. Thinking blocks are not shown.
- Scrolls like a terminal: `↑/↓`, `PgUp/PgDn`, `Home`/`g`, `End`/`G`, and mouse wheel over the panel. Pinned to the bottom while following new output; scrolling up pauses the follow, `End` resumes it.
- Live-updates while agents run; `Esc` closes. Shows the most recent call only — scroll the transcript (`Ctrl+O`) for older ones.

The panel is an experimental pi overlay; keyboard input always works, mouse wheel depends on your terminal's SGR mouse reporting.

## No nesting

Spawned sub-agents run with `PI_SUBAGENTS_CHILD=1` in their environment; the extension sees it at load time and skips tool registration. Sub-agents therefore cannot spawn their own sub-agents, while keeping every other installed extension available.

Side effect: if you export `PI_SUBAGENTS_CHILD=1` in your own shell, `spawn_agents` will not appear in your sessions.

## Differences from the official example

- Agents are defined inline per invocation — no `~/.pi/agent/agents/*.md` discovery, no project-scope agents or trust prompts.
- One mode: an array of specs. The official single/parallel/chain modes are gone (chain = orchestration).
- Nesting is prevented (the official example allows it).
