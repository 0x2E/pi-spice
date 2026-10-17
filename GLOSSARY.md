# pi-spice

Small, self-contained pi extensions published as individual npm packages. This glossary fixes the terms used across extension docs and discussions.

## Language

**Block**:
One background-colored display unit in the pi transcript: a tool row, a thinking block, a custom message. A rendering concept — in the session file these are entries and message parts.
_Avoid_: element, widget

**Tool row**:
The block a tool call produces: one status-colored box holding the call slot followed by the result slot.
_Avoid_: tool block, tool call block

**Summary line**:
The collapsed rendering of a block — a tool row or a thinking block: one line of glyph, label, and meta. (minimize-blocks)
_Avoid_: preview (reserved for thinking-preview), compact line

**Preview**:
The collapsed rendering of a thinking block: a status line plus its last two lines. (thinking-preview)
_Avoid_: summary

**Expanded**:
pi's built-in global display state in which blocks render their full content; toggled by `ctrl+o` (tool rows and thinking blocks alike in minimize-blocks); per-tool-block by click in fullscreen mode only (regular mode leaves the mouse to the terminal).
_Avoid_: unfolded, maximized
