# @pi-spice/collapse-blocks

## 0.2.0

### Minor Changes

- d63e838: Collapsed thinking summaries now show how long the model thought — counting up live while it streams, exact once it ends — instead of a line count. Blocks without a measured time (e.g. after a restart or session change) still show the line count.

### Patch Changes

- ca49ad1: Documentation and comment cleanup, including shorter package descriptions. No behavior change.

## 0.1.0

### Minor Changes

- d417f31: Add collapse-blocks: collapse tool rows and thinking blocks into one-line summaries. Everything expands with pi's own `ctrl+o` (plus per-block click on tool blocks in fullscreen); no new keys. Mutually exclusive with thinking-preview, which gains a note saying so.
