---
"@pi-spice/minimal-subagents": patch
"@pi-spice/all": patch
---

Details panel: alt+a now toggles (also closes an open panel); panel data is seeded the moment spawn_agents starts, so alt+a works during the child-startup window and after an interrupt instead of reporting "no data"; alt+a with no run at all shows pi's notify; panel content gets inner padding and footer hints that fit narrow panels.
