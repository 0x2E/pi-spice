---
"@pi-spice/thinking-preview": patch
"@pi-spice/all": patch
---

Simplify thinking-preview line handling: replace the width-aware slicing tables with plain character-count clipping to the terminal width. Wide characters (CJK, emoji) may wrap an occasional extra preview row — accepted height jitter in exchange for the simpler implementation.
