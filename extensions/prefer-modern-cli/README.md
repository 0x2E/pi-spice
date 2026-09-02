# @pi-spice/prefer-modern-cli

Nudges the model to use modern CLI tools (`rg`, `fd`) instead of `grep` / `egrep` / `ack` / `find` when it hand-writes search commands inside bash calls, and notifies once at session start which tools were detected.

pi's built-in `grep` and `find` tools are already ripgrep/fd-backed and unaffected — this extension only covers the gap where the model writes its own search command in a `bash` invocation. Nothing is blocked and no commands are rewritten.

## Install

```bash
pi install npm:@pi-spice/prefer-modern-cli
```

Quick test without installing (from this repo):

```bash
pi -e ./extensions/prefer-modern-cli
```

## How it works

Before anything is injected, the extension checks that each preferred tool (`rg`, `fd`) is actually usable in bash commands: it probes pi's managed copy in `~/.pi/agent/bin` by absolute path (pi auto-downloads ripgrep/fd there when the system copies are missing, and prepends that directory to the bash tool's `PATH` — pi's own process does not see it), then falls back to `--version` on the system `PATH`. The result is cached per extension instance; `/reload`, `/new`, `/resume` and `/fork` rebuild the instance and re-check.

- **System prompt** — on `before_agent_start`, when the `bash` tool is active, appends one line per *available* tool under a `## CLI Tool Preferences` heading (e.g. "Prefer `rg` over `grep`, `egrep`, or `ack` in bash commands."). Missing tools are skipped: telling the model to use a missing binary would only produce failing commands.
- **Session-start badge** — right after detection, a one-line status badge shows the result, missing tools included:

  ```
  ◆ prefer-modern-cli  rg ✓ · fd ✗
  ```

  The badge label is accent-colored, ✓ is green, ✗ is red, the rest dim — eye-catching without imitating any other UI element. Rendered as a transcript line in TUI mode; RPC hosts receive the pre-colored text via the notify protocol; print/JSON modes skip it. The state cannot change mid-session (the bash tool's `PATH` is fixed), so a one-shot notice is all it needs.

Cache-friendly: the appended text is static and lands at the very end of the system prompt, producing a byte-identical prompt on every turn — so provider prompt caching is unaffected.

## License

MIT
