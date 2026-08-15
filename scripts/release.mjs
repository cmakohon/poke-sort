// Cuts a release: bumps every package, writes a changelog entry, commits, tags
// and pushes. Pushing the tag is what starts .github/workflows/release.yml.
//
//   node scripts/release.mjs <patch|minor|major> [--dry-run]
//
// Replaces the older version-bump.mjs, which bumped four of the five packages.
// The one it missed was packages/desktop — the only one electron-builder reads
// for appInfo.version, so a bump shipped an installer stamped with the previous
// version, and the About screen (which reads the root package.json through
// vite's __APP_VERSION__) disagreed with the app it was describing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const type = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!["patch", "minor", "major"].includes(type)) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major> [--dry-run]");
  process.exit(1);
}

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim();

// A half-cut release is worse than none, so everything that can be checked up
// front is checked before anything is written.
if (git("status", "--porcelain")) {
  console.error("Working tree is dirty. Commit or stash first.");
  process.exit(1);
}

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch === "HEAD") {
  console.error("Detached HEAD — check out a branch first.");
  process.exit(1);
}

// All five move together. packages/web/vite.config.ts reads the ROOT version
// into __APP_VERSION__ while electron-builder reads packages/desktop, so a
// version that only lives in one of them is a version the app contradicts.
const MANIFESTS = [
  "package.json",
  "packages/desktop/package.json",
  "packages/server/package.json",
  "packages/shared/package.json",
  "packages/web/package.json",
];

const rootPkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8"));
let [major, minor, patch] = rootPkg.version.split(".").map(Number);
if (type === "major") [major, minor, patch] = [major + 1, 0, 0];
else if (type === "minor") [major, minor, patch] = [major, minor + 1, 0];
else patch += 1;
const version = `${major}.${minor}.${patch}`;
const tag = `v${version}`;

if (git("tag", "--list", tag)) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

console.log(`${rootPkg.version} -> ${version}`);

for (const file of MANIFESTS) {
  const full = path.join(ROOT, file);
  const pkg = JSON.parse(readFileSync(full, "utf-8"));
  pkg.version = version;
  // Two-space JSON with a trailing newline is what these files already are;
  // matching it keeps the diff to the one line that changed.
  if (!dryRun) writeFileSync(full, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`  ${file}`);
}

// Only app tags (vX.Y.Z) count as a previous release. Data assets get their own
// tags — the card catalog ships as catalog-v3 — and are not releases of this app.
const previous = git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0];
const range = previous ? `${previous}..HEAD` : "HEAD";
const subjects = git("log", range, "--no-merges", "--pretty=%s")
  .split("\n")
  .filter(Boolean);

const today = new Date().toISOString().slice(0, 10);
const entry = [
  `## ${version} — ${today}`,
  "",
  ...(subjects.length ? subjects.map((s) => `- ${s}`) : ["- No changes recorded."]),
  "",
  "",
].join("\n");

const changelogPath = path.join(ROOT, "CHANGELOG.md");
const header = "# Changelog\n\n";
const existing = existsSync(changelogPath)
  ? readFileSync(changelogPath, "utf-8").replace(header, "")
  : "";
if (!dryRun) writeFileSync(changelogPath, header + entry + existing);
console.log(`  CHANGELOG.md (${subjects.length} commits since ${previous || "the beginning"})`);

if (dryRun) {
  console.log("\n--dry-run: nothing written, nothing tagged.");
  process.exit(0);
}

git("add", ...MANIFESTS, "CHANGELOG.md");
git("commit", "-m", `Release ${tag}`);
// The tag must point at the bump commit: the workflow checks the tag out, and
// packages/desktop/package.json at that commit is what names the artifacts.
git("tag", "-a", tag, "-m", tag);
git("push", "--follow-tags", "origin", branch);

console.log(`\nPushed ${tag}. The Release workflow will build a draft release.`);
console.log(`Once the installers are smoke-tested:  gh release edit ${tag} --draft=false --latest`);
