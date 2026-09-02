# AGENTS.md

pi-spice: a monorepo of pi extensions published as individual npm packages. Each extension is small, self-contained, and zero-dependency. TypeScript is loaded directly via jiti — there is no build step.

## Conventions

- All changes land via PR into `main`.

- Each extension is a directory `extensions/<name>/` containing at least these three files (extra modules are fine, imported relatively from the entry):
  - `index.ts` — the extension entry; the name is fixed by both `pi.extensions` globs. Starts with a header comment stating what it does, why, and the install command. See `extensions/prefer-modern-cli/index.ts` for the style.
  - `package.json` — copy from an existing extension and name it `@pi-spice/<name>`. `keywords` must include `pi-package` (gallery discoverability). `description` is the core value in one clause. Every `@earendil-works/*` / `typebox` import goes in `peerDependencies` with a `"*"` range — pi bundles these itself.
  - `README.md` — what npm shows. Title is the package name (`# @pi-spice/<name>`). One sentence of purpose, the install command, each user-visible effect with one example. Depth stops at the user's session; implementation and rationale live in `index.ts`.

- The repo root is a private container (never published); the published meta-package `@pi-spice/all` lives in `packages/all/`. Because it bundles every extension, it rides every release: a PR touching anything under `extensions/**` adds a `.changeset/<name>.md` declaring every touched extension plus `@pi-spice/all` at the highest bumped level (CI in `.github/workflows/changeset-check.yml` rejects PRs that skip this):

  ```md
  ---
  "@pi-spice/minimal-subagents": minor
  "@pi-spice/all": minor
  ---

  One-line description of the user-facing change.
  ```

- Adding an extension needs no wiring (the globs and the publish-time copy pick it up). New extensions start at version `0.0.0`; their first changeset decides the initial published version (`minor` → `0.1.0`). Add one item to the root `README.md` extension list — that list is the single source of truth, and each item is the core value in one clause.

- At publish time the Release workflow copies `extensions/` into `packages/all/` (npm `files` cannot reach outside a package's own directory). A release is merging the bot's "Version Packages" PR — it bumps, writes CHANGELOGs, publishes, and tags `@pi-spice/<pkg>@<version>`; merge it late to batch. Feature PRs carry changesets; the Version PR alone edits version numbers.

- Publish runs with `ignore-scripts`: extensions must not need lifecycle scripts.

## Verification

- Quick test: `pi -e ./extensions/<name>/`, or `pi -e .` for every extension at once.
- Local install: `pi install ./extensions/<name>`.
