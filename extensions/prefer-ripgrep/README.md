# pi-prefer-ripgrep

Nudges the model to use `rg` (ripgrep) instead of `grep` / `egrep` / `ack` when it hand-writes search commands inside bash calls.

pi's built-in `grep` tool is already backed by ripgrep (spawns `rg --json`, respects `.gitignore`) and is unaffected — this extension only covers the gap where the model writes its own search command in a `bash` invocation.

## Install

```bash
pi install npm:@0x2e/pi-prefer-ripgrep
```

Quick test without installing (from this repo):

```bash
pi -e ./extensions/prefer-ripgrep
```

## How it works

On `before_agent_start`, when the `bash` tool is active, appends a short search-command preference to the system prompt. Nothing is blocked and no commands are rewritten.

## License

MIT
