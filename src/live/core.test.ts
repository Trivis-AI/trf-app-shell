import { test } from "node:test";
import assert from "node:assert/strict";
import { Coalescer, OwnWrites, SseParser, reconnectDelay, type LiveChangeEvent } from "./core.ts";

const ev = (id: string, local = false): LiveChangeEvent => ({
  event_id: "e-" + id, service: "purchase", entity_type: "purchase_invoice", entity_id: id, action: "update", actor: "other", local,
});

test("SseParser reassembles messages across chunk boundaries", () => {
  const p = new SseParser();
  assert.deepEqual(p.push("event: ready\ndata: {\"connection_id\":\"c1\"}\n"), []);
  assert.deepEqual(p.push("\n:hb\n\nevent: change\ndata: {\"a\":1}\n\ndata: tail"), [
    { event: "ready", data: '{"connection_id":"c1"}' },
    { event: "change", data: '{"a":1}' },
  ]);
  assert.deepEqual(p.push("\r\n\r\n"), [{ event: "message", data: "tail" }]);
});

test("OwnWrites remembers a write for its window only", () => {
  let now = 1000;
  const w = new OwnWrites(() => now);
  w.mark("purchase_invoice", "x", 500);
  assert.equal(w.has("purchase_invoice", "x"), true);
  assert.equal(w.has("purchase_invoice", "y"), false);
  now = 1600;
  assert.equal(w.has("purchase_invoice", "x"), false);
});

test("Coalescer delivers the first event at once and the burst together", () => {
  let now = 0;
  const timers: { fn: () => void; at: number }[] = [];
  const batches: ReturnType<Coalescer["add"]>[] = [];
  const out: unknown[] = [];
  const c = new Coalescer((b) => out.push(b), {
    intervalMs: 500,
    now: () => now,
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: (h) => { const i = timers.indexOf(h as never); if (i >= 0) timers.splice(i, 1); },
  });
  const run = (until: number) => {
    now = until;
    for (const t of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  void batches;
  c.add(ev("a"));
  run(0);
  assert.equal(out.length, 1, "leading edge");
  c.add(ev("b"));
  c.add(ev("b"));
  c.add(ev("c", true));
  run(100);
  assert.equal(out.length, 1, "inside the interval nothing more goes out");
  run(500);
  assert.equal(out.length, 2, "trailing edge");
  assert.deepEqual((out[1] as { ids: string[] }).ids, ["b"], "local ids are not external ids");
  assert.equal((out[1] as { reason: string }).reason, "external");
  c.add(ev("d", true));
  run(1000);
  assert.equal((out[2] as { reason: string }).reason, "local");
  c.askResync();
  c.add(ev("e"));
  run(1500);
  assert.equal((out[3] as { reason: string }).reason, "resync", "a resync wins over the events it folds in");
  c.dispose();
});

test("reconnectDelay doubles to a cap with jitter", () => {
  assert.equal(reconnectDelay(1, () => 0.5), 1000);
  assert.equal(reconnectDelay(3, () => 0.5), 4000);
  assert.equal(reconnectDelay(20, () => 0.5), 30000);
  assert.ok(reconnectDelay(1, () => 0) >= 700 && reconnectDelay(1, () => 1) <= 1300);
});
