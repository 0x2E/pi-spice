# @pi-spice/thinking-preview

Collapse streaming thinking blocks into a compact, live-refreshing preview.

pi streams reasoning tokens in full, which can flood the transcript on long thinking turns. This extension turns every thinking block into a fixed-height preview instead:

```
│ ✻ thinking · 142 lines · alt+t to expand
│ …second-to-last line of the thinking…
│ …last line of the thinking…
```

The block renders as a blockquote, so it carries pi's `│ ` left bar and quote color — visually distinct from plain thinking text, echoing the framed look of tool-call rows (an exact `edit`/`bash`-style background box isn't reachable from a Markdown transformer).

The preview refreshes on every streaming token, so the block doubles as a progress indicator — no flooding, but you always roughly know where the model is.

## Install

```bash
pi install npm:@pi-spice/thinking-preview
```

Quick test without installing: `pi -e ./extensions/thinking-preview/`

## How it works

- Uses a Markdown transformer (`pi.registerMarkdownTransformer`), which is **display-only**: the session file and the model context keep the full thinking text, untouched.
- Preview content is plain text — Markdown syntax characters are escaped and rendered verbatim — and every line (status line included) is hard-sliced to the available terminal width minus the `│ ` bar (width-aware for CJK/emoji), so the block stays within the status line plus two content lines on normal terminal widths.
- `alt+t` (or `/thinking-preview`) toggles **all** thinking blocks between preview and full text. Expanded mode shows the full text as escaped plain text inside the same `│ `-framed block, with source line breaks preserved; long lines wrap naturally. Toggling re-renders history immediately and shows a notification. Restart resets to the collapsed preview default.
- The toggle is global and sticky: once expanded, new thinking blocks render in full until you toggle back.

## Interaction with pi's built-in thinking controls

- `ctrl+t` (hide thinking blocks) takes precedence: while thinking is hidden, blocks render as a one-line label and this extension has no visible effect on the transcript — though the `alt+t` notification still fires. Press `ctrl+t` to make thinking visible again.
- `ctrl+t` *showing* thinking also goes through this extension, so it shows the preview — not full text. Use `alt+t` for full text.
- Toggling re-applies the default hidden-thinking label (`Thinking...`); if you customized that label elsewhere, it will be reset on toggle.

## Notes

- Old thinking blocks pick up a mode change immediately (the toggle forces a re-render), and restored sessions render collapsed previews too.
- `alt+t` was chosen because every `ctrl+letter` combination is bound in pi's default keybindings. If you have `alt+t` bound to something else, `/thinking-preview` works as a fallback.
