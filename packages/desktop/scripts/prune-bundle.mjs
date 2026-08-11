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
import { readdir, rm, stat } from "node:fs/promises";
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

/** Every file matching `predicate`, recursively. */
async function collect(dir, predicate, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collect(p, predicate, out);
    else if (predicate(p)) out.push(p);
  }
  return out;
}

const before = await dirSize(BUNDLE);
console.log(`bundle before: ${mb(before)} (target ${PLATFORM}/${ARCH})`);

// 1. onnxruntime-node ships prebuilt binaries for every platform and arch;
//    all but one are dead weight. This is the single biggest win.
const ortRoots = await collect(
  path.join(BUNDLE, "node_modules/.pnpm"),
  (p) => p.endsWith(path.join("onnxruntime-node", "package.json")),
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
for (const entry of await readdir(path.join(BUNDLE, "node_modules/.pnpm")).catch(
  () => [],
)) {
  if (entry.startsWith("onnxruntime-web@")) {
    await rm(path.join(BUNDLE, "node_modules/.pnpm", entry), {
      recursive: true,
      force: true,
    });
  }
}
for (const f of await collect(
  path.join(BUNDLE, "node_modules/.pnpm"),
  (p) => p.includes("@huggingface") && p.endsWith(".wasm"),
)) {
  await rm(f, { force: true });
}

// 3. Source maps. Only ever read by a debugger attached to the packaged app.
for (const f of await collect(BUNDLE, (p) => p.endsWith(".map"))) {
  await rm(f, { force: true });
}

// 4. Type-only packages are never require()d at runtime.
const pnpmDir = path.join(BUNDLE, "node_modules/.pnpm");
for (const entry of await readdir(pnpmDir).catch(() => [])) {
  if (entry.startsWith("@types+")) {
    await rm(path.join(pnpmDir, entry), { recursive: true, force: true });
  }
}

const after = await dirSize(BUNDLE);
console.log(`bundle after:  ${mb(after)}  (saved ${mb(before - after)})`);
