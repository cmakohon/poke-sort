// Trims the `pnpm deploy` output before electron-builder copies it in.
//
// The deploy tree is a faithful install, which means it carries things a
// packaged, single-platform desktop app can never use: onnxruntime binaries
// for every OS/arch, source maps, and TypeScript type packages. Left alone
// they roughly quadruple the installer.
//
// Assumes the build host matches the build target, which is how the release
// workflow runs (a matrix of macos/windows/ubuntu, each packaging natively).
// Override with PRUNE_PLATFORM / PRUNE_ARCH for a cross-build.
import { readdir, readlink, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(here, "../.server-bundle");
const PLATFORM = process.env.PRUNE_PLATFORM ?? process.platform;
const ARCH = process.env.PRUNE_ARCH ?? process.arch;

async function dirSize(dir) {
  let total = 0;
  const walk = async (d) => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) {
        try {
          total += (await stat(p)).size;
        } catch {
          /* raced */
        }
      }
    }
  };
  await walk(dir);
  return total;
}

const mb = (bytes) => `${(bytes / 1e6).toFixed(0)} MB`;

/** Every file matching `predicate`, recursively. Symlinks are never followed. */
async function collect(dir, predicate, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collect(p, predicate, out);
    else if (predicate(p)) out.push(p);
  }
  return out;
}

/** Every directory whose own name matches `predicate`, recursively. */
async function collectDirs(dir, predicate, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isSymbolicLink() || !e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (predicate(e.name)) out.push(p);
    else await collectDirs(p, predicate, out);
  }
  return out;
}

/** Every symlink, recursively, without following any of them. */
async function collectLinks(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) out.push(p);
    else if (e.isDirectory()) await collectLinks(p, out);
  }
  return out;
}

// Rooted at node_modules rather than node_modules/.pnpm so the same passes work
// under either layout: `pnpm deploy` runs with node-linker=hoisted (see
// bundle-server.mjs), which produces a flat tree with no .pnpm at all, but a
// plain isolated tree nests everything under .pnpm — which is itself here.
const NM = path.join(BUNDLE, "node_modules");

const before = await dirSize(BUNDLE);
console.log(`bundle before: ${mb(before)} (target ${PLATFORM}/${ARCH})`);

// 1. onnxruntime-node ships prebuilt binaries for every platform and arch;
//    all but one are dead weight. This is the single biggest win.
const ortRoots = await collect(NM, (p) =>
  p.endsWith(path.join("onnxruntime-node", "package.json")),
);
for (const pkgJson of ortRoots) {
  const binRoot = path.join(path.dirname(pkgJson), "bin", "napi-v3");
  let platforms;
  try {
    platforms = await readdir(binRoot);
  } catch {
    continue;
  }
  for (const platform of platforms) {
    if (platform !== PLATFORM) {
      await rm(path.join(binRoot, platform), { recursive: true, force: true });
      continue;
    }
    for (const arch of await readdir(path.join(binRoot, platform))) {
      if (arch !== ARCH) {
        await rm(path.join(binRoot, platform, arch), {
          recursive: true,
          force: true,
        });
      }
    }
  }
}

// 2. The browser ONNX backend. @huggingface/transformers depends on
//    onnxruntime-web, but its node build only require()s onnxruntime-node and
//    onnxruntime-common — the WASM backend and its .wasm blobs are never
//    reached in a Node process. Verified by removing both and confirming a
//    real 768-dim embedding still comes out; re-check if transformers is
//    upgraded, since it is a dependency of theirs and not of ours.
// `onnxruntime-web` when hoisted, `onnxruntime-web@<version>` when isolated.
for (const dir of await collectDirs(
  NM,
  (name) => name === "onnxruntime-web" || name.startsWith("onnxruntime-web@"),
)) {
  await rm(dir, { recursive: true, force: true });
}
for (const f of await collect(
  NM,
  (p) => p.includes("@huggingface") && p.endsWith(".wasm"),
)) {
  await rm(f, { force: true });
}

// 3. Source maps. Only ever read by a debugger attached to the packaged app.
for (const f of await collect(BUNDLE, (p) => p.endsWith(".map"))) {
  await rm(f, { force: true });
}

// 4. Type-only packages are never require()d at runtime. `@types` when hoisted,
//    `@types+foo@x.y.z` when isolated.
for (const dir of await collectDirs(
  NM,
  (name) => name === "@types" || name.startsWith("@types+"),
)) {
  await rm(dir, { recursive: true, force: true });
}

// 5. Links that will not survive being copied into the app.
//
//    Two kinds. The obvious one is a link whose target was just deleted above.
//    The subtle one is a link that still resolves *here* but only because it
//    reaches back into the workspace: `pnpm deploy` leaves
//    `.pnpm/node_modules/@poke-sort/server -> ../../../../../../server`, which
//    lands on packages/server from inside .server-bundle and on nothing at all
//    once electron-builder has copied the tree into Contents/Resources.
//
//    Node never resolves through either — @poke-sort/shared is bundled into
//    dist/index.js by tsup, and nothing requires the server from within itself.
//    The packaging step is what cares: `xattr -cr` and `codesign` both walk the
//    tree and both fail outright on a link they cannot follow.
let broken = 0;
for (const link of await collectLinks(NM)) {
  const target = path.resolve(path.dirname(link), await readlink(link));
  const escapes = !target.startsWith(BUNDLE + path.sep);
  if (escapes) {
    await rm(link, { force: true });
    broken++;
    continue;
  }
  try {
    await stat(link); // follows the link; throws when the target is gone
  } catch {
    await rm(link, { force: true });
    broken++;
  }
}
if (broken > 0) console.log(`removed ${broken} unusable symlink(s)`);

const after = await dirSize(BUNDLE);
console.log(`bundle after:  ${mb(after)}  (saved ${mb(before - after)})`);
