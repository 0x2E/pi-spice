# @pi-spice/sandbox

OS-level sandboxing for pi's bash tool. Every bash command — including your
own `!` commands — runs inside an OS-enforced sandbox (sandbox-exec on macOS,
bubblewrap on Linux) via [`@anthropic-ai/sandbox-runtime`](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime),
the runtime behind Claude Code's sandbox.

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
  being written or overwritten — both at the project root and in nested
  directories (`packages/x/.env`, `config/server.key`). On Linux
  (bubblewrap backend), `sandbox-runtime` currently enforces **exact-path**
  `denyWrite` entries only (e.g. `.env` at the project root); the glob
  patterns apply on macOS and are kept for forward compatibility.
- The project's own `.pi/sandbox.json` is write-denied inside the sandbox,
  so sandboxed commands cannot rewrite the policy the next session loads.
- **Git worktrees & submodules** work out of the box: when git metadata
  lives outside the project (a `git worktree` checkout's shared `.git`, a
  submodule's gitdir), those directories are added to the write allowlist
  automatically at enable time. `hooks/` and `config/` inside every git
  directory stay write-denied — they execute or load in later unsandboxed
  git runs, so writing them from inside the sandbox would be an escape.
  `/sandbox` lists the auto-allowed paths. Operations on a *parent*
  project's working tree from inside a submodule remain out of scope.
- Sandboxed commands run through the same backend as the built-in bash
  tool, so they see an identical environment (session variables like
  `PI_*`, `~/.pi/agent/bin` on `PATH`).

## Toggle

Toggle at runtime (no config editing needed) — this is the recommended way:

```
/sandbox on      # enable for this session (initializes the sandbox on demand)
/sandbox off     # disable — tears the sandbox runtime down; bash runs unsandboxed
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

- Global: `~/.pi/agent/sandbox.json`
- Project: `<project>/.pi/sandbox.json` — only honored once the project is
  trusted (pi's project-trust prompt); an untrusted checkout cannot weaken
  the sandbox for itself. `/sandbox` says so when a project config was
  ignored for this reason.

The `network` / `filesystem` fields use the same vocabulary as Claude
Code's `sandbox` settings (both are backed by `sandbox-runtime`), so
allowlists translate directly. Arrays in a config file **replace the
 defaults wholesale** — they are not merged with them. To add one domain
 while keeping the rest, copy the default list and extend it; to remove a
 default, copy the list and delete the entry. (Run `/sandbox` to print the
 effective configuration, including defaults.)

Example project config that replaces the default egress allowlist with a
 narrower one (GitHub only):

```json
{
	"enabled": true,
	"network": {
		"allowedDomains": [
			"github.com",
			"api.github.com",
			"raw.githubusercontent.com"
		],
		"deniedDomains": []
	},
	"filesystem": {
		"denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"],
		"allowWrite": [".", "/tmp"],
		"denyWrite": [".env", ".env.*", "*.pem", "*.key", "**/.env", "**/.env.*", "**/*.pem", "**/*.key"]
	}
}
```

Out of the box (no config files) the allowlist covers npm, PyPI (including
`files.pythonhosted.org` for wheels), Go modules (`proxy.golang.org`,
`sum.golang.org`), Rust crates (`crates.io`, `index.crates.io`,
`static.crates.io`), and GitHub; `denyWrite` covers `.env`, `.env.*`,
`*.pem`, and `*.key` at any depth (exact paths on Linux, see above).

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
