# @pi-spice/prefer-modern-cli

Nudges the model to use modern CLI tools (`rg`, `fd`) instead of `grep` / `egrep` / `ack` / `find` when it hand-writes search commands inside bash calls.

pi's built-in `grep` and `find` tools are already ripgrep/fd-backed and unaffected — this extension only covers the gap where the model writes its own search command in a `bash` invocation.

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

- **Available** — on `before_agent_start`, when the `bash` tool is active, appends a short search-command preference for each available tool to the system prompt. Built-in `grep`/`find` are only mentioned when they are actually active. Nothing is blocked and no commands are rewritten.
- **Missing** — the guideline for that tool is skipped (telling the model to use a missing binary would only produce failing commands) and a yellow warning banner is added to the transcript, right when the agent is entered with `bash` active. The banner is a custom session entry: it persists across resumes of that session, is shown once (not duplicated on resume/fork/reload), and is never sent to the LLM.

Cache-friendly: the appended text is static and lands at the very end of the system prompt, producing a byte-identical prompt on every turn — so provider prompt caching is unaffected.

## License

MIT
