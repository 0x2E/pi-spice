# AGENTS.md

pi-spice: a monorepo of small, self-contained, zero-dependency pi extensions, published as individual npm packages. TypeScript loads directly via jiti — there is no build step.

## Conventions

- All changes land via PR into `main`.

- Each extension is a directory `extensions/<name>/` containing at least these three files (extra modules are fine, imported relatively from the entry):
  - `index.ts` — extension entry. Both `pi.extensions` globs expect this name. Start with a header comment stating what it does, why, and the install command; see `extensions/prefer-modern-cli/index.ts`.
  - `package.json` — copy from an existing extension and name it `@pi-spice/<name>`. Include the `pi-package` keyword (gallery discoverability). `description` is the core value in one clause. Put every `@earendil-works/*` / `typebox` import in `peerDependencies` with a `"*"` range — pi bundles them itself.
  - `README.md` — what npm shows. Title is `# @pi-spice/<name>`. One sentence of purpose, the install command, and one example per user-visible effect. Stop at the user's session; implementation and rationale live in `index.ts`.

- Adding an extension needs no wiring — the `pi.extensions` globs pick it up. Add one row to the root `README.md` extension table; that table is the single source of truth.

- The extension description appears in the package.json `description`, the extension README, the root README table, and the `index.ts` header. Keep them consistent and change all occurrences together.

- Custom components that match keystrokes (`handleInput`) must use key ids: `matchesKey(data, "right")` or `kb.matches(data, "tui.…")`. Raw byte literals (`"\x1b[C"`, `"\x1b"`) cover only legacy encodings; pi negotiates the kitty keyboard protocol at startup, where those keys arrive as CSI-u sequences (see `extensions/minimal-subagents/panel.ts`). `pi.registerShortcut` / `registerCommand` are host-side and safe as-is.

## Versioning & Release

- Every extension is published individually — there is no bundle package. A PR touching anything under `extensions/**` adds a `.changeset/<name>.md` declaring every touched extension; CI (`.github/workflows/changeset-check.yml`) rejects PRs that skip this. New extensions start at `0.0.0`; their first changeset decides the initial version.

- A release is merging the bot's "Version Packages" PR — it bumps versions, writes CHANGELOGs, publishes, and tags. Merge it late to batch. Feature PRs carry changesets; the Version PR alone edits version numbers.

- Publish runs with `ignore-scripts`: extensions must not need lifecycle scripts.

## Verification

- Run `npm run check` (typecheck + smoke) before pushing; CI runs it on every PR (`.github/workflows/check.yml`). The smoke harness (`scripts/smoke/`) drives renderers and transformers with pi's real result-text shapes and scans the installed pi and pi-ai packages for the args, render forms, and event types the extensions depend on. Extend it when an extension grows behavior.

- Harnesses and other repo scripts are `.ts` run directly by Node's type stripping (unflagged since Node 22.18; pi itself requires ≥ 22.19). The root `package.json` sets `"type": "module"`, so no `.mts` is needed. `tsconfig.json` typechecks `extensions/`; `tsconfig.scripts.json` adds Node types for `scripts/`.

- Quick test (isolated): `pi -ne -e ./extensions/<name>/` — `-ne` skips globally installed extensions, so old global packages (e.g. `@pi-spice/all`) can't contaminate the session. Use `pi -e .` only when you want every extension at once. For interactive behavior (rendering, mouse, keys), drive a real session in a pty: `tmux new-session -d -s t 'pi -ne -e ./extensions/<name>/ --tui-mode fullscreen'`, then `tmux send-keys` / `tmux capture-pane`.

- Before reasoning about pi UI behavior (rendering, mouse, keybindings), read the user's `~/.pi/agent/settings.json` — `tuiMode`, `theme`, and `packages` change what the user sees. Verify keybinding claims empirically: pi's help text can advertise a binding that does nothing.

- Repo-wide sweeps need `rg --hidden` (`.changeset/` is a dot-directory).
