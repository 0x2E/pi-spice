# @pi-spice/thinking-preview

## 0.1.3

### Patch Changes

- d417f31: Add collapse-blocks: collapse tool rows and thinking blocks into one-line summaries. Everything expands with pi's own `ctrl+o` (plus per-block click on tool blocks in fullscreen); no new keys. Mutually exclusive with thinking-preview, which gains a note saying so.

## 0.1.2

### Patch Changes

- 96ca282: Simplify thinking-preview line handling: replace the width-aware slicing tables with plain character-count clipping to the terminal width. Wide characters (CJK, emoji) may wrap an occasional extra preview row — accepted height jitter in exchange for the simpler implementation.
