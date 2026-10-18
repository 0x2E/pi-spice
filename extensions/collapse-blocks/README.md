# @pi-spice/collapse-blocks

Collapse tool rows and thinking blocks into one-line summaries.

pi renders every tool row and reasoning stream in full, so an active session scrolls itself away. This extension collapses the seven tools it covers — `bash`, `edit`, `write`, `read`, `grep`, `find`, `ls` — and thinking blocks to a single line; failures keep one line of the error:

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

- **Running calls** show the command and the live last output line, so long builds still show progress.
- **Finished calls** show what the tool did: status and duration for `bash`, `+`/`−` line stats for `edit`/`write`, line count for `read`, hit count for `grep`/`find`/`ls`.
- **Thinking blocks** show the time the model spent thinking in that run: whole seconds while it streams, the exact length once it stops. Time spent writing the answer does not count. Blocks with no recorded time — after a restart or `/reload` — show a line count.
- **Other tools** (MCP, custom, `powershell`) render unchanged. Results that contain images still render the images.

## Expanding

- `ctrl+o` expands and collapses **all** rows, showing exactly what stock pi shows.
- Clicking a block toggles **that** block — fullscreen mode only; regular mode leaves the mouse to the terminal.
- Thinking blocks expand with the same `ctrl+o`.
- `/collapse-blocks` does the same as `ctrl+o`, for when that key is rebound (tree view reuses it to cycle filters).

Collapsed is the default; a restart resets it.

## Notes

- Display-only: the session file and the model context are untouched.
- **Mutually exclusive with [@pi-spice/thinking-preview](../thinking-preview/)**, which rewrites thinking display through the same transformer slot. While both are installed, thinking is double-framed and `ctrl+o` cannot reveal the full text.

## License

MIT
