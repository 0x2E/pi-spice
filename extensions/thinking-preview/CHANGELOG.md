# @pi-spice/thinking-preview

## 0.1.2

### Patch Changes

- 96ca282: Simplify thinking-preview line handling: replace the width-aware slicing tables with plain character-count clipping to the terminal width. Wide characters (CJK, emoji) may wrap an occasional extra preview row — accepted height jitter in exchange for the simpler implementation.
