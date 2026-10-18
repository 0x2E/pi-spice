# @pi-spice/minimal-subagents

Create sub-agents dynamically and run them in parallel.

`spawn_agents({ agents: [spec...] })` takes an inline spec per agent — a single task is an array of one — runs up to eight per call (four at a time), and returns when all finish. Each sub-agent is an isolated `pi` process with its own context window. The child-process code is adapted from pi's official subagent example.

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
| `name` | — | `agent-1`, `agent-2`, … |

- **Failures don't cancel siblings.** Every agent runs to completion unless you abort. Each result is a `### [name] completed/failed` section with the agent's final output or error (50 KB cap); full transcripts stay in the tool details. `isError` is set only when every agent fails.
- **Live progress.** A one-line call header (`spawn_agents (3 agents)`), then one block per agent: glyph, name, duration/tools once started, and the first task line. Running agents add a third line with their latest activity (tool call, text, or `starting…`); failures put the error on the header. Finished multi-agent calls add a dim totals line (wall-clock, tools, output tokens, cost). `alt+a live details` appears only while agents run; `Ctrl+O` after completion expands to final outputs.
- **Abort** returns partial results: finished agents keep their output, in-flight and queued agents are marked `aborted`. On POSIX the child process group is killed with `SIGTERM`, then `SIGKILL` after 5 s; on Windows only the child process is killed.

## Details panel (`alt+a`)

- One tab per sub-agent (`←`/`→` or `1`-`8`; the tab bar compacts on narrow panels), labeled with name and live status (`✻`/`·`/`✓`/`✗`).
- Each tab is the agent's full timeline: task, tool calls, tool-result previews (first 10 lines), assistant output as Markdown, usage. Thinking is not shown.
- Scrolling: `↑/↓`, `PgUp`/`PgDn`, `Home`/`g`, `End`/`G`, mouse wheel. New output follows at the bottom; scrolling up pauses; `End` resumes.
- `alt+a` toggles the panel; `Esc` closes. Before any run, `alt+a` shows pi's notify instead of an empty panel.
- Shows the latest call only. The panel is an overlay (covers the transcript), and mouse wheel works only in `--tui-mode fullscreen`, where pi enables terminal mouse reporting.

## No nesting

Children run with `PI_SUBAGENTS_CHILD=1`, which makes the extension skip tool registration, and with `--exclude-tools spawn_agents` as a backstop. This is a guard, not a sandbox: a child with `bash` can still start `pi` manually (e.g. `env -u PI_SUBAGENTS_CHILD pi ...`). Use `tools` restrictions or a container for hard isolation. Exporting `PI_SUBAGENTS_CHILD=1` in your own shell also hides `spawn_agents`.

## License

MIT
