#!/usr/bin/env node
// Guard for the changeset discipline — run on every PR by changeset-check.yml.
//
// Rules (see .changeset/README.md for the human-readable version):
//   A. every extension directory changed by the PR must be declared, by name,
//      in a changeset added/modified by that same PR
//   B. every changeset that releases anything must also release "@pi-spice/all"
//      (the meta-package bundles all extensions, so it rides every release)
//
// Changesets are parsed with the official @changesets/parse — quoting styles
// and YAML quirks are its problem, not ours.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import parse from "@changesets/parse";

const ALL = "@pi-spice/all";

const base = process.argv[2] ?? (process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`);
if (!base) {
  console.error("usage: node scripts/check-changesets.mjs <base-ref>");
  process.exit(2);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}

// ACMRD counts deletions too: removing a file under extensions/ must ship.
const changed = git("diff", "--name-only", "--diff-filter=ACMRD", `${base}...HEAD`);

const touchedExtensions = [
  ...new Set(changed.filter((p) => p.startsWith("extensions/")).map((p) => p.split("/")[1])),
];

if (touchedExtensions.length === 0) {
  console.log("no extension changes in this PR");
  process.exit(0);
}

const changesetFiles = changed.filter(
  (p) => /^\.changeset\/[^/]+\.md$/.test(p) && p !== ".changeset/README.md" && existsSync(p),
);

const errors = [];
const declared = new Map(); // package name → changeset file declaring it
const rank = { none: 0, patch: 1, minor: 2, major: 3 };

for (const file of changesetFiles) {
  let releases;
  try {
    releases = parse(readFileSync(file, "utf8")).releases;
  } catch (err) {
    errors.push(`${file}: changesets cannot parse this file (${err.message})`);
    continue;
  }
  const names = releases.map((r) => r.name);
  const allLevel = releases.find((r) => r.name === ALL)?.type;
  if (names.length > 0 && !allLevel) {
    errors.push(`${file}: declares [${names.join(", ")}] but omits ${ALL}`);
  } else if (allLevel) {
    const extHighest = Math.max(0, ...releases.filter((r) => r.name !== ALL).map((r) => rank[r.type] ?? 0));
    if (rank[allLevel] < extHighest) {
      errors.push(`${file}: ${ALL} is ${allLevel} but should match the highest extension bump (needs ${extHighest === 3 ? "major" : extHighest === 2 ? "minor" : "patch"})`);
    }
  }
  for (const name of names) declared.set(name, file);
}

for (const ext of touchedExtensions) {
  if (!declared.has(`@pi-spice/${ext}`)) {
    errors.push(`extensions/${ext}/ changed, but no changeset in this PR declares "@pi-spice/${ext}:"`);
  }
}

if (errors.length > 0) {
  for (const err of errors) console.error(`::error::${err}`);
  process.exit(1);
}

console.log(
  `ok: ${touchedExtensions.length} extension(s) covered by ${changesetFiles.length} changeset(s)`,
);
