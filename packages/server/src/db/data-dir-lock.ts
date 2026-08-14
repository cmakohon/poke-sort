import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Refuses to start when another live process already holds the data directory.
 *
 * PGlite is single-process. A second opener does not fail loudly — it corrupts
 * the write-ahead log, and the damage only surfaces on the NEXT cold start,
 * long after whoever caused it has moved on. That has now happened twice on
 * this project: both times a stray dev server was left running, the app was
 * launched against the same directory, everything looked fine for as long as a
 * process held the database in memory, and the next launch died with
 * `PANIC: could not locate a valid checkpoint record`.
 *
 * PGlite's own `postmaster.pid` cannot be used for this: it records the WASM
 * singleton's fake pid (-42), not an OS process, so it says nothing about
 * whether anyone is actually running. Hence a lock of our own holding a real
 * pid that can be checked for liveness.
 *
 * Advisory, not bulletproof — a `kill -9` leaves a stale lock, which is why a
 * dead pid is taken over rather than treated as fatal. It is aimed squarely at
 * the failure that actually happens: two servers started on purpose, minutes
 * apart, by someone who believed the first one had stopped.
 *
 * Two checks, because the lock file alone is not enough: it only sees processes
 * that carry this code. A build predating it — an app already running when you
 * pull, which is precisely the situation on an upgrade — leaves no lock, and a
 * fresh server would sail past and open the directory anyway. So the kernel is
 * asked as well, via lsof, which cannot be fooled by a missing or stale file.
 */

export interface DataDirLock {
  release(): void;
}

interface LockFile {
  pid: number;
  startedAt: string;
  argv: string;
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 checks for existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function read(file: string): LockFile | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as LockFile;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    // Missing, truncated or hand-edited: treat as no lock rather than as a
    // reason to refuse to boot.
    return null;
  }
}

/**
 * Pids, other than our own, that currently hold a file open under `dir`.
 *
 * Returns null — meaning "no answer", which is not the same as "nobody" — when
 * lsof is missing or unusable, so the caller falls back to the lock file rather
 * than reading a tooling gap as an all-clear.
 */
export function holdersOf(dir: string): number[] | null {
  let stdout: string;
  try {
    stdout = execFileSync("lsof", ["-t", "+D", dir], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
  } catch (err) {
    const failure = err as NodeJS.ErrnoException & { stdout?: string };
    // lsof exits 1 both when nothing matches AND when it found holders but hit
    // an unreadable path along the way — it still prints the pids either way.
    // Trusting the exit code here is what made an earlier version of this check
    // report "safe to start" while the app had the database open.
    if (failure.code === "ENOENT" || failure.stdout === undefined) return null;
    stdout = failure.stdout;
  }

  const pids = stdout
    .split("\n")
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
  return [...new Set(pids)];
}

function describe(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    })
      .trim()
      .slice(0, 120);
  } catch {
    return "(could not read command line)";
  }
}

export class DataDirBusyError extends Error {
  constructor(dataDir: string, holder: LockFile) {
    super(
      [
        `The data directory is already open in another process.`,
        ``,
        `  directory : ${dataDir}`,
        `  held by   : pid ${holder.pid}, since ${holder.startedAt}`,
        `  command   : ${holder.argv}`,
        ``,
        `PGlite is single-process. Starting a second one corrupts the`,
        `write-ahead log, and the damage only appears on the next cold start.`,
        `Stop the other process first (check with:`,
        `  lsof +D ${dataDir}`,
        `) — killing this one instead would leave the corruption in place.`,
      ].join("\n"),
    );
    this.name = "DataDirBusyError";
  }
}

/**
 * Takes the lock, or throws DataDirBusyError if a live process holds it.
 * Call before opening the database, not after.
 */
export function acquireDataDirLock(dataDir: string, dbDir?: string): DataDirLock {
  const file = path.join(dataDir, "server.lock");

  const existing = read(file);
  if (existing && existing.pid !== process.pid && isAlive(existing.pid)) {
    throw new DataDirBusyError(dataDir, existing);
  }

  // The kernel's answer, which does not depend on the other process having
  // cooperated by writing a lock file.
  const holders = dbDir ? holdersOf(dbDir) : null;
  const live = holders?.filter(isAlive) ?? [];
  if (live.length > 0) {
    throw new DataDirBusyError(dataDir, {
      pid: live[0],
      startedAt: "unknown (found via lsof, not a lock file)",
      argv: describe(live[0]),
    });
  }

  const mine: LockFile = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    argv: process.argv.slice(1).join(" "),
  };
  writeFileSync(file, JSON.stringify(mine, null, 2));

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    // Only ever remove our own lock: a crash-and-restart race could otherwise
    // have this process delete the lock a newer one legitimately holds.
    const current = read(file);
    if (current?.pid === process.pid) rmSync(file, { force: true });
  };

  // Covers the paths the signal handlers do not: an uncaught throw, or a
  // parent that goes away and takes this process with it.
  process.once("exit", release);

  return { release };
}
