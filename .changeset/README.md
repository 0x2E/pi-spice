# Changesets

Pending release notes live here as small markdown files ("changesets") until the
next Version PR consumes them.

Every PR that changes anything under `extensions/**` must add one file here:

```md
---
"@pi-spice/minimal-subagents": minor
"@pi-spice/all": minor
---

Allow disabling tool result truncation.
```

- Bump level is `patch`, `minor`, or `major` (all written out explicitly; an
  empty release type is a parse error).
- Always include `@pi-spice/all` at the highest level used: the meta-package
  bundles every extension, so it must ride every release.
  `.github/workflows/changeset-check.yml` rejects PRs that skip either part.
- Merging PRs only accumulates changesets here. The bot keeps a "Version
  Packages" PR open showing the batch; merging it bumps versions, writes
  CHANGELOGs, publishes everything not yet on npm, and tags each package as
  `@pi-spice/<pkg>@<version>`.
