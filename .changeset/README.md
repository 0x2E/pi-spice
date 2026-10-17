# Changesets

Pending release notes live here as small markdown files ("changesets") until the
next Version PR consumes them.

Every PR that changes anything under `extensions/**` must add one file here:

```md
---
"@pi-spice/minimal-subagents": minor
---

Allow disabling tool result truncation.
```

- Bump level is `patch`, `minor`, or `major` (all written out explicitly; an
  empty release type is a parse error).
- Every extension the PR touches must be declared. Extensions are published
  individually — there is no bundle package.
  `.github/workflows/changeset-check.yml` rejects PRs that skip this.
- Merging PRs only accumulates changesets here. The bot keeps a "Version
  Packages" PR open showing the batch; merging it bumps versions, writes
  CHANGELOGs, publishes everything not yet on npm, and tags each package as
  `@pi-spice/<pkg>@<version>`.
