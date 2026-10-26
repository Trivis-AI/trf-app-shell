// node --test src/panel/pageCompose.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { composePageContext } from "./pageCompose.ts";

const uuid = "3f2a9c1e-7b4d-4e0a-9c3b-1d2e3f4a5b6c";
const list = { type: "purchase_invoice", filters: { status: "unpaid" }, visibleIds: [uuid], total: 12 };

test("without a declaration the route describes the page", () => {
  const ctx = composePageContext({
    appId: "purchase",
    pathname: `/app/acme/invoices/${uuid}`,
    path: `/invoices/${uuid}`,
    routeEntity: { type: "purchase_invoice", id: uuid },
    declared: null,
  });
  assert.deepEqual(ctx, { app: "purchase", path: `/invoices/${uuid}`, entity: { type: "purchase_invoice", id: uuid } });
});

test("a declaration on this pathname adds the page, the list and the selection", () => {
  const ctx = composePageContext({
    appId: "purchase",
    pathname: "/app/acme/invoices",
    path: "/invoices",
    routeEntity: null,
    declared: { pathname: "/app/acme/invoices", page: "purchase-invoices", list, selected: { type: "purchase_invoice", ids: [uuid] } },
  });
  assert.deepEqual(ctx, { app: "purchase", path: "/invoices", page: "purchase-invoices", list, selected: { type: "purchase_invoice", ids: [uuid] } });
});

test("a declaration made on another pathname is ignored", () => {
  const ctx = composePageContext({
    appId: "purchase",
    pathname: `/app/acme/invoices/${uuid}`,
    path: `/invoices/${uuid}`,
    routeEntity: { type: "purchase_invoice", id: uuid },
    declared: { pathname: "/app/acme/invoices", page: "purchase-invoices", list },
  });
  assert.deepEqual(ctx, { app: "purchase", path: `/invoices/${uuid}`, entity: { type: "purchase_invoice", id: uuid } });
});

test("an empty selection is no selection; a declared entity wins over the route", () => {
  const ctx = composePageContext({
    appId: "purchase",
    pathname: `/app/acme/invoices/${uuid}`,
    path: `/invoices/${uuid}`,
    routeEntity: { type: "purchase_invoice", id: "other" },
    declared: { pathname: `/app/acme/invoices/${uuid}`, page: "purchase-invoice", entity: { type: "purchase_invoice", id: uuid }, selected: { type: "purchase_invoice", ids: [] } },
  });
  assert.deepEqual(ctx, { app: "purchase", path: `/invoices/${uuid}`, page: "purchase-invoice", entity: { type: "purchase_invoice", id: uuid } });
});

test("no app or no pathname means no context", () => {
  assert.equal(composePageContext({ appId: undefined, pathname: "/app/acme", path: "/", routeEntity: null, declared: null }), null);
  assert.equal(composePageContext({ appId: "purchase", pathname: undefined, path: "/", routeEntity: null, declared: null }), null);
});
