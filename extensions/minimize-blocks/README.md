# @pi-spice/minimize-blocks

Collapse built-in tool rows in the pi transcript into one-line summaries.

pi renders tool calls in full — command, diff, file contents, output preview — so an active session scrolls itself away. With this extension, every tool row of the seven built-in tools collapses to a single line; failures keep one line of error tail:

```
$ npm test · ✓ 3.2s
✎ src/index.ts +12 −3
▤ src/app.ts · 210 lines
⌕ renderCall · 8 matches
$ cargo build · ✗ 18.4s
error: could not compile `pi-tui`
```

While a call runs, the row shows the command plus the live last output line, so long builds still show progress.

## Install

```bash
pi install npm:@pi-spice/minimize-blocks
```

Quick test without installing: `pi -e ./extensions/minimize-blocks/`

## Expanding

Expansion reuses pi's own keys — no new bindings:

- `n` (or `ctrl+o`) expands/collapses **all** tool rows.
- Clicking a row expands/collapses **that** row.
- An expanded row renders exactly what stock pi shows.

Collapsed is the default; a restart resets it.

## How it works

- Covers the seven built-in tools: `bash`, `edit`, `write`, `read`, `grep`, `find`, `ls`. Other tools (MCP, custom) render unchanged.
- Per-tool summaries: bash shows command, status and duration; edit/write the path with `+`/`−` line stats; read the path with its line count; grep/find/ls the query with hit counts.
- Display-only (`pi.registerToolRenderer`): the session file and the model context are untouched.
- Pairs with [@pi-spice/thinking-preview](../thinking-preview/), which does the same for thinking blocks; the two touch disjoint mechanisms and never conflict.

## License

MIT
