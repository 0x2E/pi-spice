# AGENTS.md

pi-spice: a monorepo of pi extensions published as individual npm packages under the `@pi-spice` scope. Each extension is small, self-contained, and zero-dependency by default. TypeScript is loaded directly via jiti — there is no build step anywhere in this repo.

## Conventions

- Each extension is a directory `extensions/<name>/` containing exactly three files to start:
  - `index.ts` — the extension itself. Starts with a header comment stating what it does, why, and the install command. See `extensions/prefer-ripgrep/index.ts` for the style.
  - `package.json` — copy from an existing extension and adjust name/description. The non-obvious rules: `keywords` must include `pi-package` (gallery discoverability); the entry point is declared via `pi.extensions`; every `@earendil-works/*` / `typebox` import must be in `peerDependencies` with a `"*"` range — pi bundles these, so they must never appear in `dependencies`.
  - `README.md` — what npm shows: purpose, install command, how it works.
- npm package name: `@pi-spice/<name>`.
- The repo root is the `@pi-spice/all` meta-package: its `pi.extensions` glob (`extensions/*/index.ts`) picks up every extension automatically — no per-extension wiring when adding one.
- New extensions get one row in the root `README.md` extension table; that table is the single source of truth for the list — do not copy it elsewhere.
- Publishing: `npm publish` inside the extension directory. For the all-in-one package, bump the root `version` and `npm publish` at the root. Bump `version` in the same commit as the change being released.

## Verification

- Quick test: `pi -e ./extensions/<name>/` (directory form; loads via the package manifest), or `pi -e .` to load every extension via the root meta-package.
- Local install: `pi install ./extensions/<name>`; from npm: `pi install npm:@pi-spice/<name>`.

## API Reference

Before writing or modifying an extension, read `docs/extensions.md` under the pi install directory (authoritative reference for events, `ctx`, `registerTool`, etc.). Local path:

```
/home/dev/.config/nvm/versions/node/v24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md
```

For working examples, see `examples/extensions/` in the same install directory. Always import types from `@earendil-works/pi-coding-agent`; pi resolves them at load time. For package manifest details, see `docs/packages.md` in the same directory.
