# @pi-spice/thinking-preview

## 0.2.0

### Minor Changes

- d63e838: The preview status line now shows how long the model thought — counting up live while it streams, exact once it ends — instead of a line count. Blocks without a measured time (e.g. after a restart or session change) still show the line count.

### Patch Changes

- ca49ad1: Documentation and comment cleanup, including shorter package descriptions. No behavior change.

## 0.1.3

### Patch Changes

- d417f31: Add collapse-blocks: collapse tool rows and thinking blocks into one-line summaries. Everything expands with pi's own `ctrl+o` (plus per-block click on tool blocks in fullscreen); no new keys. Mutually exclusive with thinking-preview, which gains a note saying so.

## 0.1.2

### Patch Changes

- 96ca282: Simplify thinking-preview line handling: replace the width-aware slicing tables with plain character-count clipping to the terminal width. Wide characters (CJK, emoji) may wrap an occasional extra preview row — accepted height jitter in exchange for the simpler implementation.
