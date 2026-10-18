# @pi-spice/minimal-subagents

Create sub-agents dynamically and run them in parallel.

`spawn_agents({ task, ... })` runs one inline agent per call and returns its final message under a `### [name]` heading. Each sub-agent is an isolated `pi` process with its own context window. For parallel work, issue several calls in one message: pi runs them concurrently, and the extension keeps at most four child processes alive at a time across the whole session — further calls queue. The child-process code is adapted from pi's official subagent example.

## Install

```bash
pi install npm:@pi-spice/minimal-subagents
```

Quick test without installing: `pi -e ./extensions/minimal-subagents/`

## How it works

| Field | Required | Default |
|---|---|---|
| `task` | ✓ | — |
| `systemPrompt` | — | none; appended to the child's system prompt |
| `model` | — | inherit the parent session's model |
| `thinking` | — | inherit the parent session's thinking level (`off`…`max`) |
| `tools` | — | child default tools; e.g. `["read","grep","find","ls"]` for read-only scouts |
| `name` | — | `agent-1`, `agent-2`, … (numbered per session, so headings never collide) |

- **Calls are independent.** Each call runs to completion unless you abort it, and a failing agent does not affect its siblings in a parallel batch. The result is a `### [name] completed/failed` section with the agent's final output or error (50 KB cap); the full transcript stays in the tool details. `isError` reflects that one agent.
- **Live progress.** One header line reads `subagent <name>` followed by its status — `✓ 7s · 1 tool · ↓1.2k · $0.003` once finished, `✻ 2s · 1 tool` while running, `· queued` while it waits for a slot — and the task's first line sits underneath. A running agent adds a line with its latest activity (tool call, text, or `starting…`); a failure puts its reason on the line after the task. `alt+a live details` appears while an agent is queued or running; `Ctrl+O` after completion expands to the full task and the final output.
- **Abort** keeps what the child already produced, marked `aborted`, instead of discarding it; calls still queued for a slot never start. On POSIX the child process group is killed with `SIGTERM`, then `SIGKILL` after 5 s; on Windows only the child process is killed.

## Details panel (`alt+a`)

- One tab per agent this session, in spawn order, most recent eight; the panel opens on the newest agent. `←`/`→` or `1`-`9` switch tabs; when they do not all fit, the bar windows around the active tab and marks hidden ones with `‹`/`›`. Each tab is labeled with name and live status: `·` queued for a slot, `✻` running, `✓` done, `✗` failed. Each tab's first line says the same in words. Tabs persist across calls, so a parallel batch stays visible after later spawns; past eight, the oldest finished tab falls off, so a running agent keeps its tab.
- Each tab is the agent's full timeline: task, tool calls, tool-result previews (first 10 lines), assistant output as Markdown, usage. Thinking is not shown.
- Scrolling: `↑/↓`, `PgUp`/`PgDn`, `Home`/`g`, `End`/`G`, mouse wheel. New output follows at the bottom; scrolling up pauses; `End` resumes.
- `alt+a` toggles the panel; `Esc` closes. Before any run, `alt+a` shows pi's notify instead of an empty panel.
- The panel is an overlay (covers the transcript), and mouse wheel works only in `--tui-mode fullscreen`, where pi enables terminal mouse reporting.

## No nesting

Children run with `PI_SUBAGENTS_CHILD=1`, which makes the extension skip tool registration, and with `--exclude-tools spawn_agents` as a backstop. This is a guard, not a sandbox: a child with `bash` can still start `pi` manually (e.g. `env -u PI_SUBAGENTS_CHILD pi ...`). Use `tools` restrictions or a container for hard isolation. Exporting `PI_SUBAGENTS_CHILD=1` in your own shell also hides `spawn_agents`.

## License

MIT
