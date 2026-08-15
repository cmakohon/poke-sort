// Ad-hoc signs the packaged macOS app.
//
// This is not polish — without it the DMG cannot be opened at all. There is no
// Developer ID for this project, and app-builder-lib skips signing entirely
// when it finds no certificate (macPackager.js: `reportError(...); return
// false`). That leaves an unsigned bundle, and the arm64 kernel refuses to map
// executable pages from an unsigned Mach-O: the process is killed before
// main() with "Code Signature Invalid". "Open Anyway" clears Gatekeeper's
// verdict; it does not exempt anything from that requirement.
//
// Electron's own linker-ad-hoc signature does not survive packaging either.
// electron-builder rewrites Info.plist (asar integrity, CFBundleIconFile,
// extendInfo), and the Info.plist hash lives in special slot -1 of the main
// executable's CodeDirectory.
//
// afterPack, not afterSign, and both halves of that matter:
//
//   * afterPack runs *before* electron-builder's own signing attempt, so the
//     day a real Developer ID exists its signature cleanly overwrites this one.
//     With afterSign the order inverts and the ad-hoc signature would clobber a
//     notarisable one, silently.
//   * afterSign only fires when signing happened. It happens to fire here today
//     because macPackager.signApp() returns true regardless of the result, but
//     that is an accident of the implementation, not a contract.
//
// Nothing mutates the bundle after this hook: sanityCheckPackage only reads,
// the signing attempt bails out, and the dmg target runs `hdiutil create
// -srcfolder`, which copies signatures verbatim.
import { execFile } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// 32- and 64-bit Mach-O plus the universal ("fat") wrapper, both endiannesses.
// A .node addon is a Mach-O bundle and a .dylib a Mach-O shared library, but
// neither has a reliable extension across the tree — and the ~100 MB of model
// weights, the PGlite wasm and the SPA assets sitting alongside them are data
// that codesign must never be handed. Reading the magic is the only honest test.
const MACHO_MAGIC = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
  0xcafebabf, 0xbfbafeca,
]);

async function isMachO(file) {
  let handle;
  try {
    handle = await open(file, "r");
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && MACHO_MAGIC.has(buffer.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/**
 * Every path codesign has to be pointed at, deepest first.
 *
 * Symlinks are never followed. The packaged server tree comes from pnpm, and
 * following its links both re-signs the same file many times over and can loop
 * forever on a dependency cycle.
 */
async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await collect(full, out);
      // Nested bundles are signed as bundles so codesign writes them their own
      // _CodeSignature seal rather than a bare Mach-O signature. A versioned
      // framework must be addressed as Versions/A: its Current/ is a symlink,
      // and signing through that produces a broken seal.
      const isVersionedFramework =
        path.basename(path.dirname(full)) === "Versions" &&
        path.dirname(path.dirname(full)).endsWith(".framework");
      if (full.endsWith(".app") || isVersionedFramework) out.push(full);
    } else if (entry.isFile() && (await isMachO(full))) {
      out.push(full);
    }
  }
  return out;
}

export default async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );

  // codesign refuses any file carrying a Finder-info or resource-fork xattr
  // ("resource fork, Finder information, or similar detritus not allowed").
  //
  // Advisory, so a failure is logged rather than thrown: xattr exits non-zero
  // if it meets even one path it cannot walk — a broken symlink is enough — and
  // the attributes it strips are absent on almost every build. Losing the whole
  // release over a tidy-up step would be the wrong trade.
  try {
    await run("xattr", ["-cr", app]);
  } catch (err) {
    console.warn(`[adhoc-sign] xattr -cr reported: ${err.message.split("\n")[0]}`);
  }

  const targets = await collect(path.join(app, "Contents"));

  // Deepest first, bundle last. Everything nested lives under Contents/Resources
  // or Contents/Frameworks, both of which are sealed into the parent's
  // CodeResources — signing anything after its parent invalidates that seal.
  targets.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  targets.push(app);

  for (const target of targets) {
    // No `--options runtime`: the hardened runtime turns on library validation,
    // which would stop the server utilityProcess dlopen-ing onnxruntime and
    // sharp (they carry their own, different, ad-hoc identity), and it buys
    // nothing without notarisation.
    //
    // No `--deep` either: Apple deprecated it for signing, and it treats loose
    // Mach-O files under Contents/Resources as resources rather than as nested
    // code — so it would never sign the server's native modules at all, which
    // is precisely the case that matters here.
    await run("codesign", [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      target,
    ]);
  }

  await run("codesign", ["--verify", "--deep", "--strict", app]);
  console.log(
    `[adhoc-sign] signed ${targets.length} paths in ${path.basename(app)}`,
  );
}
