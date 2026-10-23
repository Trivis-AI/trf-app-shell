// node --test src/panel/pageEntity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageEntityFromPath, pagePath } from "./pageEntity.ts";

const uuid = "3f2a9c1e-7b4d-4e0a-9c3b-1d2e3f4a5b6c";

test("pagePath drops the org prefix and keeps the rest", () => {
  assert.equal(pagePath("/app/acme/invoices/" + uuid), "/invoices/" + uuid);
  assert.equal(pagePath("/app/acme"), "/");
  assert.equal(pagePath("/app/acme/"), "/");
  assert.equal(pagePath("/invoices"), "/invoices", "no prefix, nothing removed");
});

test("a UUID or a number in the id position names the entity; words do not", () => {
  assert.deepEqual(pageEntityFromPath("purchase", "/invoices/" + uuid), { type: "purchase_invoice", id: uuid });
  assert.deepEqual(pageEntityFromPath("invoices", "/invoices/" + uuid), { type: "invoice", id: uuid });
  assert.deepEqual(pageEntityFromPath("crm", "/tasks/42"), { type: "task", id: "42" });
  assert.equal(pageEntityFromPath("purchase", "/invoices/new"), null);
  assert.equal(pageEntityFromPath("purchase", "/invoices/import"), null);
  assert.equal(pageEntityFromPath("payments", "/statements/imports"), null);
  assert.equal(pageEntityFromPath("purchase", "/invoices"), null);
  assert.equal(pageEntityFromPath("audit", "/audit-logs"), null, "an app with no table");
});

test("a trailing segment still names the entity; the more specific route wins", () => {
  assert.deepEqual(pageEntityFromPath("ledger", `/entries/${uuid}/edit`), { type: "ledger_entry", id: uuid });
  assert.deepEqual(pageEntityFromPath("crm", `/contacts/${uuid}/interactions/7`), { type: "interaction", id: "7" });
  assert.deepEqual(pageEntityFromPath("crm", `/contacts/${uuid}/interactions`), { type: "contact", id: uuid });
  assert.deepEqual(pageEntityFromPath("settings", `/hr/payroll/${uuid}`), { type: "payroll_run", id: uuid });
  assert.equal(pageEntityFromPath("settings", "/hr/payroll/rules"), null);
});
