// node --test src/panel/protocol.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_BRIDGE_MAX_BYTES,
  aiPanelPath,
  envelope,
  identityFromToken,
  parseHostMessage,
  parsePanelMessage,
} from "./protocol.ts";

const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const token = (claims: object) => `h.${b64url(JSON.stringify(claims))}.s`;

test("panel messages: only the marker, the version and a known type pass", () => {
  assert.equal(parsePanelMessage(null, "c1"), null);
  assert.equal(parsePanelMessage("loaded", "c1"), null);
  assert.equal(parsePanelMessage({ type: "loaded" }, "c1"), null);
  assert.equal(parsePanelMessage({ trf: "trf-ai-panel", v: 2, type: "loaded" }, "c1"), null);
  assert.equal(parsePanelMessage(envelope({ type: "context" }), "c1"), null);
  assert.deepEqual(parsePanelMessage(envelope({ type: "loaded" }), null), envelope({ type: "loaded" }));
});

test("panel messages: everything after loaded needs the current connection id", () => {
  const ready = { type: "ready", conn: "c1", account: "a", org: "o", slug: "s" } as const;
  assert.deepEqual(parsePanelMessage(envelope(ready), "c1"), envelope(ready));
  assert.equal(parsePanelMessage(envelope(ready), "c2"), null, "an older connection");
  assert.equal(parsePanelMessage(envelope(ready), null), null, "before any connection");
  assert.equal(parsePanelMessage(envelope({ type: "close" }), "c1"), null, "no connection id at all");
  const conversation = { type: "conversation", conn: "c1", active: true } as const;
  assert.deepEqual(parsePanelMessage(envelope(conversation), "c1"), envelope(conversation));
});

test("host messages: init carries its own connection id, the rest must match it", () => {
  const init = envelope({ type: "init", conn: "c9", slug: "s", theme: { mode: "light", palette: "default" }, lang: "en", visible: true, expanded: false });
  assert.deepEqual(parseHostMessage(init, null), init);
  assert.equal(parseHostMessage(envelope({ type: "init", slug: "s" }), null), null, "init without conn");
  assert.deepEqual(parseHostMessage(envelope({ type: "focus", conn: "c9" }), "c9"), envelope({ type: "focus", conn: "c9" }));
  assert.equal(parseHostMessage(envelope({ type: "focus", conn: "c8" }), "c9"), null);
  assert.equal(parseHostMessage(envelope({ type: "loaded" }), "c9"), null, "a panel type sent by a host");
});

test("the send-time snapshot: the request from the panel, the answer from the host, both on the connection", () => {
  const request = { type: "context-request", conn: "c1", request: "r1" } as const;
  assert.deepEqual(parsePanelMessage(envelope(request), "c1"), envelope(request));
  assert.equal(parsePanelMessage(envelope(request), "c2"), null);
  const snapshot = envelope({ type: "context-snapshot", conn: "c1", request: "r1", app: "purchase", path: "/invoices", selected: { type: "purchase_invoice", ids: ["1"] }, version: 4 });
  assert.deepEqual(parseHostMessage(snapshot, "c1"), snapshot);
  assert.equal(parseHostMessage(snapshot, "c0"), null);
  assert.equal(parseHostMessage(envelope({ type: "context-request", conn: "c1", request: "r1" }), "c1"), null, "a panel type sent by a host");
});

test("oversized payloads are dropped", () => {
  const big = envelope({ type: "unread", conn: "c1", unread: true, pad: "x".repeat(AI_BRIDGE_MAX_BYTES) });
  assert.equal(parsePanelMessage(big, "c1"), null);
});

test("identity comes from the token's a.i and o.i claims", () => {
  assert.deepEqual(identityFromToken(token({ a: { i: "acc", u: "x" }, o: { i: "org", n: "Firma OÜ" } })), { account: "acc", org: "org" });
  assert.equal(identityFromToken(token({ a: { u: "x" }, o: { n: "Firma" } })), null);
  assert.equal(identityFromToken("not a token"), null);
  assert.equal(identityFromToken(null), null);
});

test("the panel route encodes the slug", () => {
  assert.equal(aiPanelPath("firma-ou"), "/app/firma-ou/panel");
  assert.equal(aiPanelPath("a b"), "/app/a%20b/panel");
});
