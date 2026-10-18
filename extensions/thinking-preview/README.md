# @pi-spice/thinking-preview

Collapse streaming thinking blocks into a compact, live-refreshing preview.

pi streams reasoning tokens in full, which floods the transcript on long thinking turns. This extension turns each thinking block into a three-line preview:

```
│ ✻ thinking · 8.4s · alt+t to expand
│ …second-to-last line of the thinking…
│ …last line of the thinking…
```

The block is a blockquote, so it keeps pi's `│ ` left bar and quote color.

## Install

```bash
pi install npm:@pi-spice/thinking-preview
```

Quick test without installing: `pi -e ./extensions/thinking-preview/`

## What you see

- **Thinking time.** The status line shows how long the model thought in that run: whole seconds while it streams, the exact length once it stops. Time spent writing the answer does not count.
- **Live tail.** The two newest lines refresh on every token, so the block works as a progress indicator.
- **Line count fallback.** Blocks with no recorded time — after a restart or `/reload` — show a line count instead.
- **Plain text.** Markdown syntax is escaped, and lines are clipped to the terminal width by character count, so text in wide characters (CJK, emoji) can wrap an extra row.

## Expanding

`alt+t` (or `/thinking-preview`) toggles **all** thinking blocks between preview and full text. Expanded blocks show the whole text in the same `│ `-framed block, with source line breaks preserved. The setting is global, re-renders history immediately, and resets on restart; a restored session starts collapsed.

## pi's built-in thinking controls

- `ctrl+t` (hide thinking blocks) takes precedence: while thinking is hidden, this extension has no visible effect, though `alt+t` still shows its notification.
- `ctrl+t` *showing* thinking renders the preview, not full text. Use `alt+t` for full text.
- Toggling re-applies the default hidden-thinking label (`Thinking...`); a custom label set elsewhere is reset.

## Notes

- Display-only: the session file and the model context keep the full thinking text.
- If `alt+t` is already bound in your keybindings, `/thinking-preview` does the same thing.
- Mutually exclusive with [@pi-spice/collapse-blocks](../collapse-blocks/), which also collapses thinking through the same transformer slot. Running both double-frames thinking blocks.
