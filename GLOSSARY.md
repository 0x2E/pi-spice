# pi-spice

Small, self-contained pi extensions published as individual npm packages. This glossary fixes the terms used across extension docs and discussions.

## Language

**Block**:
A display unit in the pi transcript: a tool row, a thinking block, or a custom message. A rendering concept — in the session file these are entries and message parts.
_Avoid_: element, widget

**Tool row**:
The block a tool call produces: a status-colored box holding the call slot followed by the result slot.
_Avoid_: tool block, tool call block

**Summary line**:
The collapsed rendering of a block: one line with a glyph, label, and meta. Running calls and streaming thinking add one live tail line; failures add one error line when present. (collapse-blocks)
_Avoid_: preview (reserved for thinking-preview), compact line

**Preview**:
The collapsed rendering of a thinking block: a status line plus up to two tail lines. (thinking-preview)
_Avoid_: summary

**Expanded**:
pi's global display state in which blocks render their full content; `ctrl+o` toggles it. In collapse-blocks it covers tool rows and thinking blocks alike; clicking a tool row toggles that row in fullscreen mode only. (thinking-preview has its own `alt+t` full-text mode.)
_Avoid_: unfolded, maximized
