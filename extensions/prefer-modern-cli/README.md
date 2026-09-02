# @pi-spice/prefer-modern-cli

Prefers modern CLI tools such as `rg` and `fd`. Prompt-only — nothing is blocked or rewritten.

## Install

```bash
pi install npm:@pi-spice/prefer-modern-cli
```

Quick test (from this repo): `pi -e ./extensions/prefer-modern-cli`

## How it works

If `rg` or `fd` is available, a preference is added to the system prompt:

```
## CLI Tool Preferences

- Prefer `rg` over `grep`, `egrep`, or `ack` in bash commands.
- Prefer `fd` over `find` in bash commands.
```

At session start, a badge shows what's available:

```
◆ prefer-modern-cli  rg ✓ · fd ✗
```

## License

MIT
