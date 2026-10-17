# @pi-spice/minimize-blocks

Collapse tool rows and thinking blocks into one-line summaries.

pi renders every block in full — command, diff, file contents, output preview, entire reasoning streams — so an active session scrolls itself away. With this extension, tool rows of the seven built-in tools and thinking blocks collapse to a single line; failures keep one line of error tail:

```
$ npm test · ✓ 3.2s
✎ src/index.ts +12 −3
▤ src/app.ts · 210 lines
⌕ renderCall · 8 matches
✻ thinking · 142 lines · alt+m to expand
$ cargo build · ✗ 18.4s
error: could not compile `pi-tui`
```

While a call runs, the row shows the command plus the live last output line; while thinking streams, the block shows its status line plus the newest line.

## Install

```bash
pi install npm:@pi-spice/minimize-blocks
```

Quick test without installing: `pi -e ./extensions/minimize-blocks/`

## Expanding

- Tool rows reuse pi's own keys — no new bindings: `n` (or `ctrl+o`) expands/collapses **all** tool rows, clicking a row toggles **that** row. An expanded row renders exactly what stock pi shows.
- Thinking blocks: `alt+m` (or `/minimize-blocks`) toggles **all** thinking blocks between summary and full text, re-rendering history immediately.

Collapsed is the default; a restart resets it.

## How it works

- Covers the seven built-in tools — `bash`, `edit`, `write`, `read`, `grep`, `find`, `ls`. Other tools (MCP, custom) render unchanged. Per-tool summaries: bash shows command, status and duration; edit/write the path with `+`/`−` line stats; read the path with its line count; grep/find/ls the query with hit counts.
- Display-only: the session file and the model context are untouched.
- **Mutually exclusive with [@pi-spice/thinking-preview](../thinking-preview/)**, which also collapses thinking. Install one or the other; running both double-frames thinking blocks.

## License

MIT
