---
"@pi-spice/thinking-preview": minor
---

Show the thinking phase's own time instead of a line count in the preview status line — counting up in whole seconds while streaming, freezing to the exact phase length when it closes. The time is measured from the phase's `thinking_start` to its `thinking_end`, or to the first text/tool-call event (openai-completions-style providers only signal `thinking_end` after the whole stream), so the text the response goes on to generate never counts; each of a response's thinking runs keeps its own phase. Timings live in memory only (the session file stays untouched): untimed blocks fall back to the line count.
