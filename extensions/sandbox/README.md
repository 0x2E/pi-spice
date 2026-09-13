# @pi-spice/sandbox

OS-level sandboxing for pi's bash tool. Every bash command — including your
own `!` commands — runs inside an OS-enforced sandbox (sandbox-exec on macOS,
bubblewrap on Linux) via [`@anthropic-ai/sandbox-runtime`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime),
the runtime behind Claude Code's sandbox.

This is the first pi-spice extension that intentionally carries a runtime
dependency — a deliberate, documented deviation from the repo's
zero-dependency convention: security-boundary code should be battle-tested,
not hand-rolled.

## Install

```bash
pi install npm:@pi-spice/sandbox
```

## What it enforces

- **Filesystem writes** are confined to the project directory and `/tmp`.
- **Sensitive dotfolders** (`~/.ssh`, `~/.aws`, `~/.gnupg`) are unreadable.
- **Network egress** only reaches a domain allowlist (npm / PyPI / GitHub by
  default); everything else is blocked, with a local proxy handling allowed
  domains.
- **Deny-write patterns** keep secrets like `.env`, `*.pem`, `*.key` from
  being overwritten. Note: on Linux (bubblewrap backend), `sandbox-runtime`
  currently enforces **exact-path** `denyWrite` entries (e.g. `.env`) but not
  glob patterns (`*.pem`); globs are kept for forward compatibility.

## Toggle

Toggle at runtime (no config editing needed) — this is the recommended way:

```
/sandbox on      # enable for this session (initializes the sandbox on demand)
/sandbox off     # disable — bash runs unsandboxed for the rest of the session
/sandbox         # show status + effective configuration
```

Toggling back on re-initializes the sandbox with freshly read config, so
mid-session config edits apply on the next `/sandbox on`. The current state
is shown as a single dim line directly above the input box — `sandbox on` or
`sandbox off`, matching the UI chrome. When initialization fails (e.g.
missing `bubblewrap`/`socat` on Linux) or the platform is unsupported, the
line shows `sandbox off (unavailable)`; the specific reason appears in the
error notification and in `/sandbox`.

The command can also override the startup state — e.g. start with
`--no-sandbox` and enable later with `/sandbox on`.

Session startup defaults (also available):

```bash
pi --no-sandbox        # start with the sandbox off
```

Or set `"enabled": false` in config for a persistent default.

## Configuration

Two config files, project takes precedence:

- Global: `~/.pi/agent/extensions/sandbox.json`
- Project: `<project>/.pi/sandbox.json`

```json
{
	"enabled": true,
	"network": {
		"allowedDomains": ["github.com", "*.github.com", "registry.npmjs.org"],
		"deniedDomains": []
	},
	"filesystem": {
		"denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
		"allowWrite": [".", "/tmp"],
		"denyWrite": [".env", ".env.*", "*.pem", "*.key"]
	}
}
```

Inside pi, `/sandbox` shows the active configuration, and `/sandbox on` /
`/sandbox off` toggle the sandbox for the current session.

Note: config files are re-read every time the sandbox initializes — at
startup and on every `/sandbox on`. Mid-session config edits take effect on
the next toggle (or restart).

## Requirements

| Platform | Notes |
| --- | --- |
| macOS | Works out of the box (built-in `sandbox-exec`) |
| Linux | Requires `bubblewrap`, `socat`, `ripgrep` — e.g. `sudo apt install bubblewrap socat ripgrep` |
| Windows | Unsupported; bash runs unsandboxed with a warning |

## Threat model & limitations

This is accident-and-exfiltration containment, not a hard boundary against
adversarial kernel-level exploits (it shares the host kernel by design) —
see the header of `index.ts` for the full threat model.

Known limitation (v1, matching pi's official sandbox example): if sandbox
initialization fails (e.g. missing `bubblewrap` on Linux), bash falls back to
unsandboxed execution with an error notification.
