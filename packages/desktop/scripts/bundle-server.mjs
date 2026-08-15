// Builds .server-bundle, the flattened server tree electron-builder copies into
// the app as extraResources.
//
// Replaces what used to be a shell one-liner. Two things forced it into a
// script: `rm -rf` does not exist on the windows-latest runner, and the deploy
// needs an rc setting overridden, which has no portable package.json spelling.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readlink, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(here, "..");
const MODELS = path.resolve(DESKTOP, "../../.models");

// electron-builder copies ../../.models as extraResources and throws an opaque
// copyFiles error if it is missing. Fail here instead, saying what to run.
if (!existsSync(MODELS)) {
  console.error(
    `No model weights at ${MODELS}.\n` +
      `Run: pnpm --filter @poke-sort/desktop fetch:model`,
  );
  process.exit(1);
}

await rm(path.join(DESKTOP, ".server-bundle"), { recursive: true, force: true });

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: DESKTOP,
    stdio: "inherit",
    // pnpm is a .cmd shim on Windows, which spawn cannot exec directly.
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// pnpm's default (isolated) linker, deliberately.
//
// `--config.node-linker=hoisted` looks like the obvious way to get a flat,
// link-free tree, and it does not work: pnpm 9.1.3 hoists to the *workspace
// root* rather than into the deploy directory, leaving .server-bundle with an
// empty node_modules and a polluted repo. Measured, not assumed.
run("pnpm", ["--filter", "@poke-sort/server", "deploy", "--prod", ".server-bundle"]);

run(process.execPath, [path.join(here, "prune-bundle.mjs")]);

/**
 * Refuses to hand electron-builder a tree it would package into broken links.
 *
 * electron-builder copies extraResources link-for-link: builder-util's copyDir
 * reads each link with readlink() and re-creates it verbatim. So a link only
 * survives packaging if it is relative *and* stays inside the tree being
 * copied. Two ways to fail that, and both have bitten this build:
 *
 *   * A relative link that reaches back into the workspace — `pnpm deploy`
 *     emits one for @poke-sort/server. It resolves here and points at nothing
 *     once the tree is inside Contents/Resources. prune-bundle.mjs strips
 *     these; this is the check that they are gone.
 *   * An absolute link. pnpm uses junctions on Windows, and readlink() on a
 *     junction returns an absolute path, so an installer built there would
 *     point at the build machine's checkout.
 *
 * Either way the app builds, uploads and installs perfectly and then dies on
 * the user's first require(). That is invisible until someone runs it, so make
 * it a build failure instead.
 */
async function findEscapingLinks(root) {
  const offenders = [];
  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const target = path.resolve(dir, await readlink(full));
        if (!target.startsWith(root + path.sep)) offenders.push(full);
      } else if (entry.isDirectory()) {
        await walk(full);
      }
    }
  };
  await walk(root);
  return offenders;
}

const bundleRoot = path.join(DESKTOP, ".server-bundle");
const escaping = await findEscapingLinks(bundleRoot);
if (escaping.length > 0) {
  console.error(
    `${escaping.length} link(s) in .server-bundle point outside it and would ` +
      `not resolve on a user's machine. First few:\n  ` +
      escaping.slice(0, 5).join("\n  "),
  );
  process.exit(1);
}

