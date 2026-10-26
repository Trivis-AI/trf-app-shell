// node --test src/panel/hostActions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_MAX_REASON, actionTypesFor, normaliseActionRequest, normaliseActionResult, normaliseNavigate } from "./hostActions.ts";

const uuid = "3f2a9c1e-7b4d-4e0a-9c3b-1d2e3f4a5b6c";

test("an action request keeps its ids, verdicts and reasons, bounded and plain", () => {
  const req = normaliseActionRequest({
    action: "approve_purchase_invoices",
    entity: "purchase_invoice",
    note: "  Approve two of three  ",
    items: [
      { id: uuid, verdict: "approve", reason: "Matches the order\u0007 and the supplier" },
      { id: "second", verdict: "hold", reason: "x".repeat(ACTION_MAX_REASON + 50) },
      { id: "third", reason: "" },
    ],
  });
  assert.ok(req);
  assert.equal(req.note, "Approve two of three");
  assert.equal(req.items.length, 3);
  assert.deepEqual(req.items[0], { id: uuid, verdict: "approve", reason: "Matches the order and the supplier" });
  assert.equal(req.items[1].reason?.length, ACTION_MAX_REASON);
  assert.deepEqual(req.items[2], { id: "third" }, "an empty reason is no reason");
});

test("an action request with a bad key, no items, a repeated id or an overlong id is refused", () => {
  const items = [{ id: uuid }];
  assert.equal(normaliseActionRequest({ action: "Approve!", entity: "purchase_invoice", items }), null);
  assert.equal(normaliseActionRequest({ action: "approve_purchase_invoices", entity: "", items }), null);
  assert.equal(normaliseActionRequest({ action: "approve_purchase_invoices", entity: "purchase_invoice", items: [] }), null);
  assert.equal(normaliseActionRequest({ action: "approve_purchase_invoices", entity: "purchase_invoice", items: [{ id: uuid }, { id: uuid }] }), null);
  assert.equal(normaliseActionRequest({ action: "approve_purchase_invoices", entity: "purchase_invoice", items: [{ id: "x".repeat(65) }] }), null);
  assert.equal(normaliseActionRequest({ action: "approve_purchase_invoices", entity: "purchase_invoice", items: [{ id: 7 }] }), null);
  assert.equal(normaliseActionRequest(null), null);
});

test("a handler's result is cut to known statuses", () => {
  assert.deepEqual(normaliseActionResult({ status: "done", items: [{ id: uuid, status: "done", detail: "confirmed" }, { id: "b", status: "nope" }, { id: "c", status: "skipped" }] }), {
    status: "done",
    items: [{ id: uuid, status: "done", detail: "confirmed" }, { id: "c", status: "skipped" }],
  });
  assert.deepEqual(normaliseActionResult({ status: "cancelled" }), { status: "cancelled" });
  assert.deepEqual(normaliseActionResult({ status: "whatever" }), { status: "failed" });
  assert.deepEqual(normaliseActionResult(undefined), { status: "failed" });
});

test("navigate: a route of ours, in this app or a named one; nothing that leaves the apps", () => {
  assert.deepEqual(normaliseNavigate({ path: "/invoices" }), { path: "/invoices" });
  assert.deepEqual(normaliseNavigate({ app: "purchase", path: `/invoices/${uuid}?tab=rows` }), { app: "purchase", path: `/invoices/${uuid}?tab=rows` });
  assert.equal(normaliseNavigate({ path: "//evil.example/x" }), null, "protocol-relative");
  assert.equal(normaliseNavigate({ path: "https://evil.example/x" }), null, "absolute");
  assert.equal(normaliseNavigate({ path: "javascript:alert(1)" }), null);
  assert.equal(normaliseNavigate({ path: "/invoices/../../admin" }), null);
  assert.equal(normaliseNavigate({ path: "invoices" }), null, "relative");
  assert.equal(normaliseNavigate({ path: "/invoices", app: "Purchase App" }), null);
  assert.equal(normaliseNavigate({ path: "/a\nb" }), null);
});

test("the action types a page offers are those registered on its pathname, sorted, once", () => {
  const entries = [
    { type: "pay_purchase_invoices", pathname: "/app/acme/invoices" },
    { type: "approve_purchase_invoices", pathname: "/app/acme/invoices" },
    { type: "approve_purchase_invoices", pathname: "/app/acme/invoices" },
    { type: "approve_purchase_invoices", pathname: "/app/acme/approvals" },
  ];
  assert.deepEqual(actionTypesFor(entries, "/app/acme/invoices"), ["approve_purchase_invoices", "pay_purchase_invoices"]);
  assert.deepEqual(actionTypesFor(entries, "/app/acme/settings"), []);
  assert.deepEqual(actionTypesFor(entries, undefined), []);
});
