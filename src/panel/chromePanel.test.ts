// node --test src/panel/chromePanel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeTakesOver, parseExtensionMessage, trivisExtensionIds } from "./chromePanel.ts";

test("the extension ids follow the environment", () => {
  assert.deepEqual(trivisExtensionIds("invoices.trf.is"), ["fhedlbeinaimjdehdcpbakdkdflcgoil"]);
  assert.deepEqual(trivisExtensionIds("localhost"), ["fhedlbeinaimjdehdcpbakdkdflcgoil"]);
  assert.deepEqual(trivisExtensionIds("invoices.trivis.ee"), []);
  assert.deepEqual(trivisExtensionIds("example.com"), []);
});

test("the Chrome panel stands in for the App panel in mode always, or while it is open", () => {
  assert.equal(chromeTakesOver({ available: true, mode: "always", open: false }), true);
  assert.equal(chromeTakesOver({ available: true, mode: "move", open: false }), false);
  assert.equal(chromeTakesOver({ available: true, mode: "move", open: true }), true);
  assert.equal(chromeTakesOver({ available: false, mode: "always", open: true }), false);
  assert.equal(chromeTakesOver({ available: null, mode: "always", open: false }), false);
});

test("extension messages: known types with the right shape only", () => {
  assert.equal(parseExtensionMessage(null), null);
  assert.equal(parseExtensionMessage({ type: "nope" }), null);
  assert.deepEqual(parseExtensionMessage({ type: "state", mode: "move", open: true, active: false, extra: 1 }), { type: "state", mode: "move", open: true, active: false });
  assert.equal(parseExtensionMessage({ type: "state", mode: "sometimes", open: true, active: false }), null);
  assert.equal(parseExtensionMessage({ type: "state", mode: "always", open: "yes", active: false }), null);
  assert.deepEqual(parseExtensionMessage({ type: "context-request", request: "r1" }), { type: "context-request", request: "r1" });
  assert.equal(parseExtensionMessage({ type: "context-request" }), null);
  assert.deepEqual(parseExtensionMessage({ type: "open-app-panel", session: "s1" }), { type: "open-app-panel", session: "s1" });
  assert.deepEqual(parseExtensionMessage({ type: "open-app-panel", session: 5 }), { type: "open-app-panel", session: null });
  assert.equal(parseExtensionMessage({ type: "navigate", path: "/x".repeat(40000) }), null, "oversized");
});
