# AGENTS.md

pi-spice: a monorepo of pi extensions published as individual npm packages. Each extension is small, self-contained, and zero-dependency by default. TypeScript is loaded directly via jiti — there is no build step.

## Conventions

- All changes land via PR into `main`.

- Each extension is a directory `extensions/<name>/` containing at least these three files (extra modules are fine, imported relatively from the entry):
  - `index.ts` — the extension entry point; the name is fixed (the meta-package globs `extensions/*/index.ts`). Starts with a header comment stating what it does, why, and the install command. See `extensions/prefer-modern-cli/index.ts` for the style.
  - `package.json` — copy from an existing extension and name it `@pi-spice/<name>`. `keywords` must include `pi-package` (gallery discoverability). Every `@earendil-works/*` / `typebox` import goes in `peerDependencies` with a `"*"` range — pi bundles these, so they must never appear in `dependencies`.
  - `README.md` — what npm shows: purpose, install command, how it works. Title is the package name (`# @pi-spice/<name>`).

- Adding an extension needs no wiring: the root `@pi-spice/all` meta-package picks up `extensions/*/index.ts`, and publishing discovers `extensions/*/package.json` automatically.

- New extensions get one row in the root `README.md` extension table — that table is the single source of truth for the list.

- Publishing is automated by `.github/workflows/publish.yml`, which publishes every package whose version is not yet on npm — bump the changed packages' `version` in the same commit as the change (release tags are `v<root version>`). Publish runs `--ignore-scripts`: extensions must not need lifecycle scripts.

## Verification

- Quick test: `pi -e ./extensions/<name>/`, or `pi -e .` to load every extension via the root meta-package.
- Local install: `pi install ./extensions/<name>`.
