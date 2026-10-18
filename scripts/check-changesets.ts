// Guard for the changeset discipline — run on every PR by changeset-check.yml.
//
// Rule (see .changeset/README.md for the human-readable version): every
// extension directory changed by the PR must be declared, by name, in a
// changeset added/modified by that same PR.
//
// Changesets are parsed with the official @changesets/parse — quoting styles
// and YAML quirks are its problem, not ours.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import parse from "@changesets/parse";

const base = process.argv[2] ?? (process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`);
if (!base) {
  console.error("usage: node scripts/check-changesets.ts <base-ref>");
  process.exit(2);
}

function git(...args: string[]) {
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

for (const file of changesetFiles) {
  let releases;
  try {
    releases = parse(readFileSync(file, "utf8")).releases;
  } catch (err) {
    errors.push(`${file}: changesets cannot parse this file (${(err as Error).message})`);
    continue;
  }
  for (const release of releases) declared.set(release.name, file);
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
