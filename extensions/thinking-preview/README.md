# @pi-spice/thinking-preview

Collapse streaming thinking blocks into a compact live preview.

pi streams reasoning tokens in full, which floods the transcript on long thinking turns. This extension turns each thinking block into a status line plus up to two tail lines:

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
- **Live tail.** The two newest non-empty lines refresh on every token, so the block works as a progress indicator.
- **Line count fallback.** Blocks with no recorded time — after a restart, `/reload`, or a session switch (`/new`, `/resume`, `/fork`) — show a line count instead.
- **Plain text.** Markdown syntax is escaped, and lines are clipped to the terminal width by character count, so text in wide characters (CJK, emoji) can wrap an extra row.

## Expanding

`alt+t` (or `/thinking-preview`) toggles **all** thinking blocks between preview and full text. Expanded blocks show the whole text in the same `│ `-framed block, with source line breaks preserved. The setting is global and re-renders history immediately. Session switches (`/new`, `/resume`, `/fork`) keep the current mode; a new pi process or `/reload` starts collapsed.

## pi's built-in thinking controls

- `ctrl+t` (hide thinking blocks) takes precedence: while thinking is hidden, this extension has no visible effect, though `alt+t` still notifies.
- `ctrl+t` showing thinking renders the current mode: the preview, or full text if you toggled `alt+t`.
- Toggling re-applies the default hidden-thinking label (`Thinking...`); a custom label set elsewhere is reset.

## Notes

- Display-only: the session file and the model context keep the full thinking text.
- If `alt+t` is already bound in your keybindings, `/thinking-preview` does the same thing.
- **Mutually exclusive with [@pi-spice/collapse-blocks](../collapse-blocks/)**. Both register an `assistant-thinking` transformer, and pi applies them in extension load order, so one wraps the other's output: thinking is double-framed. Install one.

## License

MIT
