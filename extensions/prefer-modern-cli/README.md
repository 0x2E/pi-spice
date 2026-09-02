# @pi-spice/prefer-modern-cli

Nudges the model to use `rg`/`fd` instead of `grep`/`egrep`/`ack`/`find` when it hand-writes search commands inside bash calls. Prompt-only — nothing is blocked or rewritten, and pi's built-in `grep`/`find` tools (already ripgrep/fd-backed) are unaffected.

## Install

```bash
pi install npm:@pi-spice/prefer-modern-cli
```

Quick test (from this repo): `pi -e ./extensions/prefer-modern-cli`

## How it works

At session start each tool is probed (pi's managed `~/.pi/agent/bin` copy or the system `PATH`), and the result is cached for the session. Then:

- One line per **available** tool is appended to the system prompt:

  ```
  ## CLI Tool Preferences

  - Prefer `rg` over `grep`, `egrep`, or `ack` in bash commands.
  - Prefer `fd` over `find` in bash commands.
  ```

- A one-shot badge in the transcript reports the detection result, missing tools included:

  ```
  ◆ prefer-modern-cli  rg ✓ · fd ✗
  ```

The appended prompt text is static and identical on every turn, so provider prompt caching is unaffected.

## License

MIT
