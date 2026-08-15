// Cuts a release, in two phases, because `dev` requires changes to arrive by
// pull request:
//
//   node scripts/release.mjs <patch|minor|major> [--dry-run]
//       bumps every package, writes the changelog, and opens a release PR
//
//   node scripts/release.mjs tag
//       after that PR merges, tags the merge commit and pushes the tag
//
// Splitting it is what keeps the tag honest. The release workflow checks out
// the tag, so the tag has to point at the commit that actually carries the new
// version — and with a squash merge that commit does not exist until GitHub
// creates it. An earlier version pushed the bump straight to `dev` and tagged
// it locally, which worked only because the author holds bypass rights on the
// branch protection rule.
//
// It replaces version-bump.mjs, which bumped four of the five packages. The one
// it missed was packages/desktop — the only one electron-builder reads for
// appInfo.version, so a bump shipped an installer stamped with the previous
// version, while the About screen (root package.json, via vite's
// __APP_VERSION__) showed the new one.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "dev";

// All five move together. packages/web/vite.config.ts reads the ROOT version
// into __APP_VERSION__ while electron-builder reads packages/desktop, so a
// version living in only one of them is a version the app contradicts.
const MANIFESTS = [
  "package.json",
  "packages/desktop/package.json",
  "packages/server/package.json",
  "packages/shared/package.json",
  "packages/web/package.json",
];

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim();

const readVersion = () =>
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8")).version;

function requireCleanTree() {
  if (git("status", "--porcelain")) {
    console.error("Working tree is dirty. Commit or stash first.");
    process.exit(1);
  }
}

const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (command === "tag") {
  tagMergedRelease();
} else if (["patch", "minor", "major"].includes(command)) {
  openReleasePr(command);
} else {
  console.error(
    "Usage:\n" +
      "  node scripts/release.mjs <patch|minor|major> [--dry-run]   open the release PR\n" +
      "  node scripts/release.mjs tag                               tag it once merged",
  );
  process.exit(1);
}

function openReleasePr(type) {
  requireCleanTree();

  const current = readVersion();
  let [major, minor, patch] = current.split(".").map(Number);
  if (type === "major") [major, minor, patch] = [major + 1, 0, 0];
  else if (type === "minor") [major, minor, patch] = [major, minor + 1, 0];
  else patch += 1;
  const version = `${major}.${minor}.${patch}`;
  const tag = `v${version}`;
  const branch = `release/${tag}`;

  if (git("tag", "--list", tag)) {
    console.error(`Tag ${tag} already exists.`);
    process.exit(1);
  }

  // Cut the branch from the base as it exists on the remote, not from whatever
  // happens to be checked out — a release should not quietly carry along
  // unmerged local work.
  git("fetch", "origin", BASE);
  console.log(`${current} -> ${version}  (branch ${branch}, base ${BASE})`);

  if (!dryRun) git("checkout", "-b", branch, `origin/${BASE}`);

  for (const file of MANIFESTS) {
    const full = path.join(ROOT, file);
    const pkg = JSON.parse(readFileSync(full, "utf-8"));
    pkg.version = version;
    // Two-space JSON with a trailing newline is what these files already are;
    // matching it keeps each diff to the single line that changed.
    if (!dryRun) writeFileSync(full, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log(`  ${file}`);
  }

  // Only app tags (vX.Y.Z) mark a previous release. Data assets carry their own
  // tags — the card catalog ships as catalog-v3 — and are not releases of this
  // app. With no previous tag every commit in the repo qualifies, which is
  // several hundred lines nobody will read; GitHub's generated notes cover the
  // detail on the release itself.
  const previous = git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0];
  const subjects = previous
    ? git("log", `${previous}..origin/${BASE}`, "--no-merges", "--pretty=%s")
        .split("\n")
        .filter(Boolean)
    : ["First tagged release."];

  const entry = [
    `## ${version} — ${new Date().toISOString().slice(0, 10)}`,
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
  console.log(`  CHANGELOG.md (${subjects.length} since ${previous || "the beginning"})`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written, no branch, no PR.");
    return;
  }

  git("add", ...MANIFESTS, "CHANGELOG.md");
  git("commit", "-m", `Release ${tag}`);
  git("push", "-u", "origin", branch);

  const body = [
    `Version bump to ${version}. Merging this does not release anything.`,
    "",
    "Once merged:",
    "",
    "```bash",
    `git checkout ${BASE} && git pull`,
    "pnpm release:tag",
    "```",
    "",
    `That tags the merge commit \`${tag}\` and pushes it, which is what starts`,
    "the Release workflow. The workflow leaves a **draft** release — smoke-test",
    "the installers, then publish:",
    "",
    "```bash",
    `gh release edit ${tag} -R cmakohon/poke-sort --draft=false --latest`,
    "```",
    "",
    "Publishing matters beyond visibility: the in-app update check reads",
    "`/releases/latest`, which ignores drafts.",
  ].join("\n");

  try {
    execFileSync("gh", ["pr", "create", "--base", BASE, "--title", `Release ${tag}`, "--body", body], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    // The branch is pushed either way, so this is recoverable by hand rather
    // than a reason to have failed.
    console.log(`\nCould not open the PR automatically. Open it against ${BASE} yourself.`);
  }

  console.log(`\nNext: merge the PR, then \`git checkout ${BASE} && git pull && pnpm release:tag\`.`);
}

function tagMergedRelease() {
  requireCleanTree();

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== BASE) {
    console.error(`On ${branch}; tag from ${BASE} so the tag lands on the merged commit.`);
    process.exit(1);
  }

  // The tag must point at the commit the workflow will check out. Tagging a
  // local HEAD that is behind or ahead of the remote would build something
  // nobody else has.
  git("fetch", "origin", BASE, "--tags");
  if (git("rev-parse", "HEAD") !== git("rev-parse", `origin/${BASE}`)) {
    console.error(`${BASE} is not in sync with origin/${BASE}. Pull first.`);
    process.exit(1);
  }

  const version = readVersion();
  const tag = `v${version}`;

  if (git("tag", "--list", tag)) {
    console.error(`Tag ${tag} already exists — was this release already cut?`);
    process.exit(1);
  }

  // Catches the most likely mistake: running this before the release PR merged,
  // which would tag the previous version's commit.
  const changelog = existsSync(path.join(ROOT, "CHANGELOG.md"))
    ? readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf-8")
    : "";
  if (!changelog.includes(`## ${version} `)) {
    console.error(
      `CHANGELOG.md has no entry for ${version}. Has the release PR been merged into ${BASE}?`,
    );
    process.exit(1);
  }

  git("tag", "-a", tag, "-m", tag);
  // Only the tag. The branch is already where it should be, by pull request.
  git("push", "origin", tag);

  console.log(`Pushed ${tag}. The Release workflow will build a draft release.`);
  console.log(
    `Once the installers are smoke-tested:  gh release edit ${tag} -R cmakohon/poke-sort --draft=false --latest`,
  );
}
