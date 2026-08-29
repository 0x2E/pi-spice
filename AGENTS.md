# AGENTS.md

pi-spice: a monorepo of pi extensions published as individual npm packages under the `@pi-spice` scope. Each extension is small, self-contained, and zero-dependency by default. TypeScript is loaded directly via jiti — there is no build step anywhere in this repo.

## Conventions

- All changes land via PR into `main` — never commit or push directly to `main`.

- Each extension is a directory `extensions/<name>/` containing exactly three files to start:
  - `index.ts` — the extension itself. Starts with a header comment stating what it does, why, and the install command. See `extensions/prefer-modern-cli/index.ts` for the style.
  - `package.json` — copy from an existing extension and adjust name/description. The non-obvious rules: `keywords` must include `pi-package` (gallery discoverability); the entry point is declared via `pi.extensions`; every `@earendil-works/*` / `typebox` import must be in `peerDependencies` with a `"*"` range — pi bundles these, so they must never appear in `dependencies`.
  - `README.md` — what npm shows: purpose, install command, how it works.
- npm package name: `@pi-spice/<name>`.
- The repo root is the `@pi-spice/all` meta-package: its `pi.extensions` glob (`extensions/*/index.ts`) picks up every extension automatically — no per-extension wiring when adding one.
- New extensions get one row in the root `README.md` extension table; that table is the single source of truth for the list — do not copy it elsewhere.
- Publishing is automated by `.github/workflows/publish.yml`: push a tag `v<version>` matching the root package `version` (the workflow verifies the match) and it publishes every package whose current version is not yet on npm — packages are discovered automatically (`extensions/*/package.json` plus the root meta-package), so a new extension needs no workflow wiring — then creates a draft GitHub release (reviewed and promoted manually). Publish runs with `--ignore-scripts`, so extensions must not need lifecycle scripts at publish time. Bump `version` in the same commit as the change being released. Requires the `NPM_TOKEN` repo secret: an npm granular access token with read/write on the `pi-spice` scope.

## Verification

- Quick test: `pi -e ./extensions/<name>/` (directory form; loads via the package manifest), or `pi -e .` to load every extension via the root meta-package.
- Local install: `pi install ./extensions/<name>`; from npm: `pi install npm:@pi-spice/<name>`.
