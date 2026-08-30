# AGENTS.md

pi-spice: a monorepo of pi extensions published as individual npm packages. Each extension is small, self-contained, and zero-dependency by default. TypeScript is loaded directly via jiti — there is no build step.

## Conventions

- All changes land via PR into `main`.

- Each extension is a directory `extensions/<name>/` containing at least these three files (extra modules are fine, imported relatively from the entry):
  - `index.ts` — the extension entry point; the name is fixed (the meta-package globs `extensions/*/index.ts`). Starts with a header comment stating what it does, why, and the install command. See `extensions/prefer-modern-cli/index.ts` for the style.
  - `package.json` — copy from an existing extension and name it `@pi-spice/<name>`. `keywords` must include `pi-package` (gallery discoverability). Every `@earendil-works/*` / `typebox` import goes in `peerDependencies` with a `"*"` range — pi bundles these, so they must never appear in `dependencies`.
  - `README.md` — what npm shows: purpose, install command, how it works. Title is the package name (`# @pi-spice/<name>`).

- Adding an extension needs no wiring: `extensions/*/index.ts` is picked up both by local dev (root `pi.extensions` glob) and by the meta-package publish step (the Release workflow copies `extensions/` into `packages/all/`).

- New extensions get one row in the root `README.md` extension table — that table is the single source of truth for the list.

- The repo root is a private container (never published). The published meta-package `@pi-spice/all` lives in `packages/all/`; at publish time the Release workflow copies `extensions/` into it (npm `files` cannot reach outside a package's own directory), so the meta-package always bundles the current extension sources. Local dev still loads from the repo root (`pi.extensions` globs `extensions/*/index.ts`).

- Releasing is managed by [changesets](https://github.com/changesets/changesets). A PR that changes anything under `extensions/**` must add a `.changeset/<name>.md` declaring every touched extension and, on its own line, `@pi-spice/all` at the highest bumped level — the meta-package bundles all extensions, so it rides every release. CI (`.github/workflows/changeset-check.yml`) rejects PRs that skip this:

  ```md
  ---
  "@pi-spice/minimal-subagents": minor
  "@pi-spice/all": minor
  ---

  One-line description of the user-facing change.
  ```

- Merging PRs only accumulates changesets. `.github/workflows/release.yml` keeps a "Version Packages" PR open showing the batch; merging that PR bumps versions, writes CHANGELOGs, publishes everything not yet on npm, and tags `@pi-spice/<pkg>@<version>` per package. Batch releases by merging it late, or ship immediately by merging it right away.

- New extensions start at version `0.0.0`; their first changeset decides the initial published version (`minor` → `0.1.0`).

- Publish runs with `ignore-scripts`: extensions must not need lifecycle scripts.

## Verification

- Quick test: `pi -e ./extensions/<name>/`, or `pi -e .` to load every extension via the root meta-package.
- Local install: `pi install ./extensions/<name>`.
