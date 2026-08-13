import type { MachineEventInput } from "@poke-sort/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMachineEventLog } from "./machine-event-log";

function makeHarness(postImpl?: (events: MachineEventInput[]) => Promise<void>) {
  const batches: MachineEventInput[][] = [];
  const post = vi.fn(
    postImpl ??
      (async (events: MachineEventInput[]) => {
        batches.push(events);
      }),
  );
  const log = createMachineEventLog(post);
  return { batches, post, log };
}

describe("createMachineEventLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps events with session, seq, and timestamp", async () => {
    const { batches, log } = makeHarness();
    log.record({ eventType: "port_opened" });
    log.record({ eventType: "ready", payload: { timedOut: false } });
    await vi.advanceTimersByTimeAsync(2000);

    expect(batches).toHaveLength(1);
    const [a, b] = batches[0];
    expect(a.sessionId).toBe(log.sessionId);
    expect(b.sessionId).toBe(log.sessionId);
    expect(b.seq).toBe(a.seq + 1);
    expect(typeof a.ts).toBe("number");
  });

  it("stamps the connection id once set, and stops after it clears", async () => {
    const { batches, log } = makeHarness();
    log.record({ eventType: "connect_failed" }); // critical → flushes alone
    log.setConnectionId("conn-1");
    log.record({ eventType: "port_opened" });
    log.setConnectionId(null);
    log.record({ eventType: "ready" });
    await vi.advanceTimersByTimeAsync(2000);

    const all = batches.flat();
    expect(all.find((e) => e.eventType === "connect_failed")?.connectionId)
      .toBeUndefined();
    expect(all.find((e) => e.eventType === "port_opened")?.connectionId).toBe(
      "conn-1",
    );
    expect(all.find((e) => e.eventType === "ready")?.connectionId)
      .toBeUndefined();
  });

  it("holds non-critical events for the flush interval", async () => {
    const { post, log } = makeHarness();
    log.record({ eventType: "exchange", outcome: "ok" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("flushes immediately when the batch reaches 25 events", async () => {
    const { post, log } = makeHarness();
    for (let i = 0; i < 24; i++) {
      log.record({ eventType: "exchange", outcome: "ok" });
    }
    expect(post).not.toHaveBeenCalled();
    log.record({ eventType: "exchange", outcome: "ok" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("flushes critical events immediately", async () => {
    const { post, log } = makeHarness();
    log.record({ eventType: "unplug" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("treats a non-ok exchange as critical, an ok exchange as not", async () => {
    const { post, log } = makeHarness();
    log.record({ eventType: "exchange", outcome: "ok" });
    expect(post).not.toHaveBeenCalled();
    log.record({ eventType: "exchange", outcome: "timeout" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("re-buffers a failed post and retries on the timer", async () => {
    let fail = true;
    const batches: MachineEventInput[][] = [];
    const { post, log } = makeHarness(async (events) => {
      if (fail) throw new Error("server down");
      batches.push(events);
    });
    log.record({ eventType: "unplug" });
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(0);

    fail = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(batches).toHaveLength(1);
    expect(batches[0][0].eventType).toBe("unplug");
  });

  it("caps the buffer, drops oldest, and reports the drop count", async () => {
    let fail = true;
    const batches: MachineEventInput[][] = [];
    const { log } = makeHarness(async (events) => {
      if (fail) throw new Error("server down");
      batches.push(events);
    });
    // 520 critical events against a dead server: each flush fails and
    // re-buffers; the cap should hold the buffer at 500.
    for (let i = 0; i < 520; i++) {
      log.record({ eventType: "read_error", payload: { i } });
      await vi.advanceTimersByTimeAsync(0);
    }
    fail = false;
    await vi.advanceTimersByTimeAsync(2000);

    const all = batches.flat();
    const overflow = all.find((e) => e.eventType === "log_overflow");
    expect(overflow).toBeDefined();
    expect(
      (overflow!.payload as { dropped: number }).dropped,
    ).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(501);
    // The oldest events are the ones that went.
    expect(
      all.some((e) => (e.payload as { i?: number })?.i === 0),
    ).toBe(false);
    expect(
      all.some((e) => (e.payload as { i?: number })?.i === 519),
    ).toBe(true);
  });

  it("drain empties the buffer for a beacon", async () => {
    const { post, log } = makeHarness();
    log.record({ eventType: "exchange", outcome: "ok" });
    log.record({ eventType: "exchange", outcome: "ok" });
    const drained = log.drain();
    expect(drained).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).not.toHaveBeenCalled();
  });

  it("records nothing after dispose", async () => {
    const { post, log } = makeHarness();
    log.dispose();
    log.record({ eventType: "unplug" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(post).not.toHaveBeenCalled();
  });
});
