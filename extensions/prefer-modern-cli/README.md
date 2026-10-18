# @pi-spice/prefer-modern-cli

Prefer modern CLI tools such as `rg` and `fd`. Prompt-only — nothing is blocked or rewritten.

## Install

```bash
pi install npm:@pi-spice/prefer-modern-cli
```

Quick test without installing: `pi -e ./extensions/prefer-modern-cli/`

## How it works

When the `bash` tool is active, each available tool adds one line to the system prompt:

```
## CLI Tool Preferences

- Prefer `rg` over `grep`, `egrep`, or `ack` in bash commands.
- Prefer `fd` over `find` in bash commands.
```

In interactive sessions, a badge at session start shows what's available:

```
◆ prefer-modern-cli  rg ✓ · fd ✗
```

## License

MIT
