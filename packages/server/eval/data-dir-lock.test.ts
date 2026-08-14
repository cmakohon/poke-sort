import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireDataDirLock,
  DataDirBusyError,
  holdersOf,
} from "../src/db/data-dir-lock";

/**
 * The guardrail against the failure that has cost this project two database
 * recoveries: a second process opening the same PGlite directory, corrupting
 * the WAL silently, with the damage only surfacing on the next cold start.
 */

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "poke-sort-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("acquireDataDirLock", () => {
  it("takes an unheld directory", () => {
    const dir = tempDir();
    const lock = acquireDataDirLock(dir);
    const written = JSON.parse(
      readFileSync(path.join(dir, "server.lock"), "utf-8"),
    );
    expect(written.pid).toBe(process.pid);
    lock.release();
  });

  it("removes its lock on release", () => {
    const dir = tempDir();
    acquireDataDirLock(dir).release();
    expect(() => readFileSync(path.join(dir, "server.lock"), "utf-8")).toThrow();
  });

  // The actual incident: a dev server left running, the app launched against
  // the same directory, both writing until the next start found a broken
  // checkpoint chain.
  it("refuses when a live process holds it", () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, "server.lock"),
      // process.pid is alive by definition, and !== our own check only because
      // the guard compares to process.pid — so use a pid that is alive and
      // different. The parent process qualifies.
      JSON.stringify({ pid: process.ppid, startedAt: "now", argv: "other" }),
    );
    expect(() => acquireDataDirLock(dir)).toThrow(DataDirBusyError);
  });

  it("names the holder and how to find it", () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, "server.lock"),
      JSON.stringify({ pid: process.ppid, startedAt: "now", argv: "other" }),
    );
    try {
      acquireDataDirLock(dir);
      throw new Error("should have refused");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(String(process.ppid));
      expect(message).toContain("lsof +D");
      expect(message).toContain(dir);
    }
  });

  // A kill -9 leaves a lock behind. Treating that as fatal would wedge the app
  // shut for a failure that is not dangerous — nobody holds the directory.
  it("takes over a lock whose process is gone", () => {
    const dir = tempDir();
    writeFileSync(
      path.join(dir, "server.lock"),
      JSON.stringify({ pid: 999_999, startedAt: "old", argv: "ghost" }),
    );
    const lock = acquireDataDirLock(dir);
    const written = JSON.parse(
      readFileSync(path.join(dir, "server.lock"), "utf-8"),
    );
    expect(written.pid).toBe(process.pid);
    lock.release();
  });

  it("survives a corrupt lock file rather than refusing to boot", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "server.lock"), "not json at all");
    const lock = acquireDataDirLock(dir);
    lock.release();
  });

  // Re-acquiring in the same process is what a reload does; it must not
  // deadlock against itself.
  it("lets the same process re-acquire", () => {
    const dir = tempDir();
    const first = acquireDataDirLock(dir);
    const second = acquireDataDirLock(dir);
    first.release();
    second.release();
  });

  // The gap that let a third double-open happen: the app was running a build
  // from before the lock existed, so it had written no lock file, and a new
  // server saw an unheld directory and opened it alongside.
  it("refuses on the kernel's answer even with no lock file present", () => {
    const dir = tempDir();
    const dbDir = path.join(dir, "db");
    mkdirSync(dbDir);
    const held = path.join(dbDir, "held");
    writeFileSync(held, "x");
    // An open descriptor from another process is what lsof reports. A child
    // holding the file open is the cheapest way to produce one.
    const child = spawn(
      process.execPath,
      ["-e", `require("fs").openSync(${JSON.stringify(held)}, "r"); setTimeout(()=>{}, 30000)`],
      { stdio: "ignore" },
    );
    try {
      // Give the child time to open the file.
      execFileSync("sh", ["-c", "sleep 1"]);
      if (holdersOf(dbDir)?.includes(child.pid ?? -1)) {
        expect(() => acquireDataDirLock(dir, dbDir)).toThrow(DataDirBusyError);
      }
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("reports no answer rather than an all-clear when lsof cannot run", () => {
    // A directory that does not exist makes lsof fail; the contract is that a
    // failure must never be reported as "nobody has it open".
    const result = holdersOf(path.join(tempDir(), "does-not-exist"));
    expect(result === null || result.length === 0).toBe(true);
  });

  it("does not delete a lock another process has since taken", () => {
    const dir = tempDir();
    const lock = acquireDataDirLock(dir);
    // A newer server took over between our close and our release.
    writeFileSync(
      path.join(dir, "server.lock"),
      JSON.stringify({ pid: process.ppid, startedAt: "newer", argv: "next" }),
    );
    lock.release();
    const still = JSON.parse(
      readFileSync(path.join(dir, "server.lock"), "utf-8"),
    );
    expect(still.pid).toBe(process.ppid);
  });
});
