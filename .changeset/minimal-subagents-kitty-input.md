---
"@pi-spice/minimal-subagents": patch
"@pi-spice/all": patch
---

Fix the details panel ignoring keys on terminals that negotiated the kitty keyboard protocol: match Esc/arrows/Home/End/number keys via `matchesKey` instead of raw escape-sequence bytes, so Esc closes and arrows switch tabs in every encoding.
