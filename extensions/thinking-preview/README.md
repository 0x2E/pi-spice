# @pi-spice/thinking-preview

Collapse streaming thinking blocks into a compact, live-refreshing preview.

pi streams reasoning tokens in full, which can flood the transcript on long thinking turns. This extension turns every thinking block into a compact preview instead:

```
│ ✻ thinking · 8.4s · alt+t to expand
│ …second-to-last line of the thinking…
│ …last line of the thinking…
```

The block renders as a blockquote, so it carries pi's `│ ` left bar and quote color — visually distinct from plain thinking text, echoing the framed look of tool-call rows (an exact `edit`/`bash`-style background box isn't reachable from a Markdown transformer).

The preview refreshes on every streaming token, so the block doubles as a progress indicator — no flooding, but you always roughly know where the model is. The status line shows the thinking phase's own time: counting up in whole seconds while it streams, freezing to the exact length when the phase closes — the text the response goes on to generate never counts. Blocks without a measured time (streamed before this session of the extension, or after a restart) fall back to a line count.

## Install

```bash
pi install npm:@pi-spice/thinking-preview
```

Quick test without installing: `pi -e ./extensions/thinking-preview/`

## How it works

- Uses a Markdown transformer (`pi.registerMarkdownTransformer`), which is **display-only**: the session file and the model context keep the full thinking text, untouched.
- The time is the phase itself (`thinking_start` through `thinking_end`, or the first text/tool-call event — openai-completions-style providers only signal `thinking_end` after the whole stream), held in memory only — the session file stays untouched, so restarted or restored sessions fall back to a line count. Each of a response's thinking runs keeps its own phase; consecutive blocks rendered as one show the last block's phase.
- Preview content is plain text — Markdown syntax characters are escaped and rendered verbatim — and every preview line (status line included) is hard-clipped to the available terminal width minus the `│ ` bar, by plain character count with no per-charset width tables. A line of wide characters (CJK, emoji) can therefore render up to twice the budget and wrap an occasional extra row — accepted jitter in exchange for simplicity.
- `alt+t` (or `/thinking-preview`) toggles **all** thinking blocks between preview and full text. Expanded mode shows the full text as escaped plain text inside the same `│ `-framed block, with source line breaks preserved; long lines wrap naturally. Toggling re-renders history immediately and shows a notification. Restart resets to the collapsed preview default.
- The toggle is global and sticky: once expanded, new thinking blocks render in full until you toggle back.

## Interaction with pi's built-in thinking controls

- `ctrl+t` (hide thinking blocks) takes precedence: while thinking is hidden, blocks render as a one-line label and this extension has no visible effect on the transcript — though the `alt+t` notification still fires. Press `ctrl+t` to make thinking visible again.
- `ctrl+t` *showing* thinking also goes through this extension, so it shows the preview — not full text. Use `alt+t` for full text.
- Toggling re-applies the default hidden-thinking label (`Thinking...`); if you customized that label elsewhere, it will be reset on toggle.

## Notes

- Mutually exclusive with [@pi-spice/collapse-blocks](../collapse-blocks/), which also collapses thinking (plus tool rows) through the same transformer slot — install one or the other; running both double-frames thinking blocks.
- Old thinking blocks pick up a mode change immediately (the toggle forces a re-render), and restored sessions render collapsed previews too.
- `alt+t` was chosen because every `ctrl+letter` combination is bound in pi's default keybindings. If you have `alt+t` bound to something else, `/thinking-preview` works as a fallback.
