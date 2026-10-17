# @pi-spice/minimize-blocks

Collapse tool rows and thinking blocks into one-line summaries.

pi renders every block in full — command, diff, file contents, output preview, entire reasoning streams — so an active session scrolls itself away. With this extension, tool rows of the seven built-in tools and thinking blocks collapse to a single line; failures keep one line of error tail:

```
$ npm test · ✓ 3.2s
✎ src/index.ts +12 −3
▤ src/app.ts · 210 lines
⌕ renderCall · 8 matches
✻ thinking · 142 lines · ctrl+o to expand
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

- Tool rows reuse pi's own keys — no new bindings: `ctrl+o` expands/collapses **all** tool rows. An expanded row renders exactly what stock pi shows. Clicking anywhere on a block — including its blank padding rows — toggles **that** block, but only in fullscreen mode; regular mode leaves the mouse to the terminal. (pi's help also lists `n`, but that binding is dead in pi 1.2.0 — it types into the editor; `ctrl+o` works.)
- Thinking blocks expand with the same `ctrl+o` — one key toggles every collapsed block (tool rows and thinking alike); clicking a tool block toggles just that block. `/minimize-blocks` does the same as `ctrl+o` for when that key is rebound (tree view cycles filters on it).

Collapsed is the default; a restart resets it.

## How it works

- Covers the seven built-in tools — `bash`, `edit`, `write`, `read`, `grep`, `find`, `ls`. Other tools (MCP, custom) render unchanged. Per-tool summaries: bash shows command, status and duration; edit/write the path with `+`/`−` line stats; read the path with its line count; grep/find/ls the query with hit counts. Results that contain images still render the images (pi draws them outside the summary row).
- Display-only: the session file and the model context are untouched.
- **Mutually exclusive with [@pi-spice/thinking-preview](../thinking-preview/)**, which rewrites thinking display through the same transformer slot. Install one or the other; while both are installed the thinking display is double-framed and `ctrl+o` cannot reveal the full text until one is removed.

## License

MIT
