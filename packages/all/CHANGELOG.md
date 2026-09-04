# @pi-spice/all

## 0.4.0

### Minor Changes

- 349aa7f: Restyle the `spawn_agents` transcript display: a one-line call header, then one block per agent — status, duration, tool count, and the first line of the task as a stable identifier, with a third line for live activity while running. Call totals (tokens/cost) sit on a summary line after completion; the hint line is running-only. Expanded view shows final outputs only. Transcript lines are truncated by display width — long commands and CJK text no longer break the layout.

## 0.3.0

### Minor Changes

- 5045b1f: One preference line per available modern CLI tool in the system prompt; drop the missing-tool warning banner.

## 0.2.1

### Patch Changes

- 245d41f: Details panel: alt+a now toggles (also closes an open panel); panel data is seeded the moment spawn_agents starts, so alt+a works during the child-startup window and after an interrupt instead of reporting "no data"; alt+a with no run at all shows pi's notify; panel content gets inner padding and footer hints that fit narrow panels.
- 96ca282: Simplify thinking-preview line handling: replace the width-aware slicing tables with plain character-count clipping to the terminal width. Wide characters (CJK, emoji) may wrap an occasional extra preview row — accepted height jitter in exchange for the simpler implementation.
