# @pi-spice/collapse-blocks

Collapse tool rows and thinking blocks into one-line summaries.

pi draws every tool row and reasoning stream in full, so an active session scrolls itself away. This extension collapses the seven tools it covers — `bash`, `edit`, `write`, `read`, `grep`, `find`, `ls` — and thinking blocks to a summary line. Running calls and streaming thinking can add one live line; failures add the last error line when present:

```
$ npm test · ✓ 3.2s
✎ src/index.ts +12 −3
▤ src/app.ts · 210 lines
⌕ renderCall · 8 matches
✻ thinking · 8.4s · ctrl+o to expand
$ cargo build · ✗ 18.4s
error: could not compile `pi-tui`
```

## Install

```bash
pi install npm:@pi-spice/collapse-blocks
```

Quick test without installing: `pi -e ./extensions/collapse-blocks/`

## What you see

- **Running calls** show the command (or path/query) and the latest output line.
- **Finished calls** show what the tool did: status and duration for `bash`; `+`/`−` line stats for `edit`/`write`; returned line count for `read`; hit count for `grep`/`find`/`ls`.
- **Thinking blocks** show the time spent thinking in that run: whole seconds while streaming, exact once it stops. Time spent writing the answer does not count. The newest line appears below the status line while streaming. Blocks without a recorded time — after a restart, `/reload`, or a session switch (`/new`, `/resume`, `/fork`) — show a line count.
- **Other tools** (MCP, custom, `powershell`) render unchanged. Images in results still render.

## Expanding

- `ctrl+o` expands and collapses every tool row and thinking block. Expanded rows use pi's own renderers.
- Clicking a tool row toggles that row — fullscreen only; regular mode leaves the mouse to the terminal.
- `/collapse-blocks` does the same as `ctrl+o` when that key is rebound (tree view reuses it to cycle filters).

Collapsed is the default; a restart resets it.

## Notes

- Display-only: the session file and the model context are untouched.
- **Mutually exclusive with [@pi-spice/thinking-preview](../thinking-preview/)**. Both register an `assistant-thinking` transformer, and pi applies them in extension load order, so one wraps the other's output: thinking is double-framed and `ctrl+o` cannot reveal the full text. Install one.

## License

MIT
