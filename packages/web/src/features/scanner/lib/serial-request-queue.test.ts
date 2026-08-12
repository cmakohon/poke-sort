import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSerialRequestQueue,
  isUnsolicitedLine,
} from "./serial-request-queue";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeHarness(writeResult: (data: string) => boolean = () => true) {
  const writes: string[] = [];
  const queue = createSerialRequestQueue(async (data) => {
    writes.push(data);
    return writeResult(data);
  });
  return { writes, queue };
}

describe("isUnsolicitedLine", () => {
  it("classifies jam alerts as unsolicited", () => {
    expect(isUnsolicitedLine('{"error":"jam","module":1}')).toBe(true);
  });

  it("classifies the boot banner as unsolicited", () => {
    expect(isUnsolicitedLine('{"status":"ready"}')).toBe(true);
  });

  it("classifies anything carrying the firmware marker as unsolicited", () => {
    expect(isUnsolicitedLine('{"status":"whatever","unsolicited":true}')).toBe(
      true,
    );
  });

  it("classifies command replies as solicited", () => {
    expect(
      isUnsolicitedLine('{"status":"ok","servo":"pusher","module":1}'),
    ).toBe(false);
    expect(isUnsolicitedLine('{"status":"test_complete"}')).toBe(false);
    expect(isUnsolicitedLine('{"error":"invalid JSON"}')).toBe(false);
  });

  it("classifies non-JSON lines as solicited (likely a mangled reply)", () => {
    expect(isUnsolicitedLine('{"status":"ok","ser')).toBe(false);
  });
});

describe("createSerialRequestQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves a request with its reply", async () => {
    const { writes, queue } = makeHarness();
    const p = queue.request('{"neutral":true}', 1000);
    await flush();
    expect(writes).toEqual(['{"neutral":true}']);
    queue.handleLine('{"status":"ok"}');
    expect(await p).toEqual({ sent: true, response: '{"status":"ok"}' });
  });

  it("holds the second request until the first exchange completes", async () => {
    const { writes, queue } = makeHarness();
    const p1 = queue.request("a", 1000);
    const p2 = queue.request("b", 1000);
    await flush();
    expect(writes).toEqual(["a"]);

    queue.handleLine("reply-a");
    expect(await p1).toEqual({ sent: true, response: "reply-a" });
    await flush();
    expect(writes).toEqual(["a", "b"]);

    queue.handleLine("reply-b");
    expect(await p2).toEqual({ sent: true, response: "reply-b" });
  });

  it("does not let an unsolicited line steal a pending reply", async () => {
    // The provider's read loop gates lines through the classifier; mimic it.
    const { queue } = makeHarness();
    const feed = (line: string) => {
      if (!isUnsolicitedLine(line)) queue.handleLine(line);
    };

    const p = queue.request('{"servo":"pusher","module":1,"value":315}', 1000);
    await flush();
    feed('{"error":"jam","module":1}');
    feed('{"status":"ok","servo":"pusher","module":1}');
    expect(await p).toEqual({
      sent: true,
      response: '{"status":"ok","servo":"pusher","module":1}',
    });
  });

  it("times out to a null response and keeps later exchanges paired", async () => {
    vi.useFakeTimers();
    const { writes, queue } = makeHarness();

    const p1 = queue.request("a", 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p1).toEqual({ sent: true, response: null });

    const p2 = queue.request("b", 500);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(["a", "b"]);
    queue.handleLine("reply-b");
    expect(await p2).toEqual({ sent: true, response: "reply-b" });
  });

  it("reports a failed write without waiting out the timeout", async () => {
    vi.useFakeTimers();
    const { queue } = makeHarness(() => false);
    const p = queue.request("a", 60000);
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toEqual({ sent: false, response: null });
  });

  it("continues past a failed write to the next request", async () => {
    const { writes, queue } = makeHarness((data) => data !== "bad");
    const p1 = queue.request("bad", 1000);
    const p2 = queue.request("good", 1000);
    expect(await p1).toEqual({ sent: false, response: null });
    await flush();
    expect(writes).toEqual(["bad", "good"]);
    queue.handleLine("ok");
    expect(await p2).toEqual({ sent: true, response: "ok" });
  });

  it("coalesces same-key requests down to the latest payload", async () => {
    const { writes, queue } = makeHarness();
    const inFlight = queue.request("move-0", 1000);
    await flush();

    const a = queue.requestLatest("servo:1:pusher", "move-1", 1000);
    const b = queue.requestLatest("servo:1:pusher", "move-2", 1000);
    const c = queue.requestLatest("servo:1:pusher", "move-3", 1000);
    await flush();
    expect(writes).toEqual(["move-0"]);

    queue.handleLine("ok-0");
    expect(await inFlight).toEqual({ sent: true, response: "ok-0" });
    await flush();
    expect(writes).toEqual(["move-0", "move-3"]);

    queue.handleLine("ok-1");
    const result = { sent: true, response: "ok-1" };
    expect(await a).toEqual(result);
    expect(await b).toEqual(result);
    expect(await c).toEqual(result);
  });

  it("does not coalesce across different keys", async () => {
    const { writes, queue } = makeHarness();
    const inFlight = queue.request("move-0", 1000);
    await flush();
    const a = queue.requestLatest("servo:1:pusher", "pusher-move", 1000);
    const b = queue.requestLatest("feederValue", "feeder-move", 1000);

    queue.handleLine("ok-0");
    await inFlight;
    await flush();
    queue.handleLine("ok-1");
    await a;
    await flush();
    queue.handleLine("ok-2");
    await b;
    expect(writes).toEqual(["move-0", "pusher-move", "feeder-move"]);
  });

  it("reset fails the in-flight request and flushes the queue", async () => {
    const { queue } = makeHarness();
    const p1 = queue.request("a", 60000);
    await flush();
    const p2 = queue.request("b", 60000);
    queue.reset();
    expect(await p1).toEqual({ sent: true, response: null });
    expect(await p2).toEqual({ sent: false, response: null });
  });
});
