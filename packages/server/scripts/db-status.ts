/**
 * Answers "is anything using the database right now?" — the question that
 * should be asked before starting a server, running a script, or launching the
 * app against a data directory.
 *
 *   pnpm --filter @poke-sort/server db:status
 *   POKE_SORT_DATA_DIR=./.poke-sort-catalog pnpm --filter @poke-sort/server db:status
 *
 * Deliberately does NOT import ../src/db — that module opens PGlite, which is
 * the exact thing this is meant to check for. It imports the leaf lock module
 * only, which opens nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { holdersOf } from "../src/db/data-dir-lock";

const DATA_DIR = path.resolve(process.env.POKE_SORT_DATA_DIR ?? "./.poke-sort");
const DB_DIR = path.join(DATA_DIR, "db");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function describe(pid: number): string {
  try {
    const out = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().slice(0, 100);
  } catch {
    return "(gone)";
  }
}

console.log(`data dir : ${DATA_DIR}`);
if (!existsSync(DB_DIR)) {
  console.log("database : does not exist yet");
  process.exit(0);
}

const lockFile = path.join(DATA_DIR, "server.lock");
if (existsSync(lockFile)) {
  try {
    const lock = JSON.parse(readFileSync(lockFile, "utf-8")) as {
      pid: number;
      startedAt: string;
      argv: string;
    };
    const state = alive(lock.pid) ? "LIVE" : "stale (process gone)";
    console.log(`lock     : pid ${lock.pid} — ${state}`);
    console.log(`           since ${lock.startedAt}`);
    console.log(`           ${lock.argv}`);
  } catch {
    console.log("lock     : present but unreadable");
  }
} else {
  console.log("lock     : none");
}

const holders = holdersOf(DB_DIR);
if (holders === null) {
  // No answer is not an all-clear. Say so, and fail closed.
  console.log("open by  : UNKNOWN — lsof unavailable, could not verify");
  process.exit(1);
}
if (holders.length === 0) {
  console.log("open by  : nothing — safe to start");
  process.exit(0);
}

console.log(`open by  : ${holders.length} process(es) — DO NOT start another`);
for (const pid of holders) console.log(`           ${pid}  ${describe(pid)}`);
process.exit(1);
