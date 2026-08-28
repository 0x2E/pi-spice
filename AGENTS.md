# AGENTS.md

A monorepo of pi extensions. Each extension is small, self-contained, and zero-dependency by default; TypeScript is loaded directly via jiti. The repo has no package.json and no build step — keep it that way.

## Conventions

- Each extension lives in `extensions/<name>/index.ts` — self-contained, zero-dependency by default. Add sibling files (helpers, `package.json`, README) only when an extension outgrows a single file.
- Each extension starts with a header comment stating what it does, why, and how to install it. See `extensions/prefer-ripgrep/index.ts` for the style.
- New extensions get one row in the `README.md` extension table; that table is the single source of truth for the list — do not copy it elsewhere.

## Verification

- Quick test: `pi -e ./extensions/<name>/index.ts`.
- Install: `cp -r extensions/<name> ~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local); supports `/reload` hot-reload.

## API Reference

Before writing or modifying an extension, read `docs/extensions.md` under the pi install directory (authoritative reference for events, `ctx`, `registerTool`, etc.). Local path:

```
/home/dev/.config/nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
```

For working examples, see `examples/extensions/` in the same install directory. Always import types from `@earendil-works/pi-coding-agent`; pi resolves them at load time.
