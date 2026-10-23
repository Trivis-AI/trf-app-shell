// Which entity a route names, per app, for the panel's `context` message
// (documentation/AI-PANEL-ACTIONS.md, section 4.5). Ids only; the agent reads the record
// itself under the person's token. Until pages declare their own context (the panel plan's
// `useAiPageContext`, section 3.6) this table is all the panel gets, so it stays small and
// obvious: a UUID or a number in the id position, nothing else. Words such as `new`,
// `import` or `edit` never match.

import type { AiPageEntity } from "./protocol";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d+";

/** `/contacts/:x/interactions/:id`: `:id` is captured, other params match but are not. */
function route(pattern: string): RegExp {
  const src = pattern.replace(/:([a-zA-Z]+)/g, (_m, name: string) => (name === "id" ? `(${ID})` : `(?:${ID})`));
  return new RegExp(`^${src}(?:/|$)`, "i");
}

const ROUTES: Record<string, Array<[RegExp, string]>> = {
  purchase: [[route("/invoices/:id"), "purchase_invoice"]],
  invoices: [[route("/invoices/:id"), "invoice"]],
  payments: [
    [route("/payments/:id"), "payment"],
    [route("/statements/:id"), "statement_import"],
    [route("/bank/:id"), "bank_account"],
  ],
  crm: [
    [route("/contacts/:x/interactions/:id"), "interaction"],
    [route("/contacts/:id"), "contact"],
    [route("/tasks/:id"), "task"],
    [route("/interactions/:id"), "interaction"],
    [route("/new-businesses/:id"), "deal"],
  ],
  items: [
    [route("/items/:id"), "item"],
    [route("/reservations/:id"), "reservation"],
  ],
  products: [[route("/products/:id"), "product"]],
  ledger: [
    [route("/entries/:id"), "ledger_entry"],
    [route("/periods/:id"), "period"],
    [route("/accounts/:id"), "account"],
    [route("/currencies/:id"), "currency"],
    [route("/tax-rates/:id"), "tax_rate"],
    [route("/dimension-types/:id"), "dimension_type"],
  ],
  reports: [
    [route("/ee-vat-reports/:id"), "vat_report"],
    [route("/ee-annual-reports/:id"), "annual_report"],
  ],
  contracts: [[route("/contracts/:id"), "contract"]],
  settings: [
    [route("/hr/employees/:id"), "employee"],
    [route("/employees/:id"), "employee"],
    [route("/hr/payroll/:id"), "payroll_run"],
    [route("/projects/:id"), "project"],
    [route("/banks/:id"), "bank"],
    [route("/locations/:id"), "location"],
  ],
  tables: [[route("/tables/:id"), "table"]],
};

/** The route without the `/app/:slug` prefix; `/` for the app root. */
export function pagePath(pathname: string): string {
  const rest = pathname.replace(/^\/app\/[^/]+/, "");
  return rest === "" ? "/" : rest;
}

/** The entity `path` (from `pagePath`) names in `app`, or null when it names none. */
export function pageEntityFromPath(app: string, path: string): AiPageEntity | null {
  for (const [re, type] of ROUTES[app] ?? []) {
    const m = re.exec(path);
    if (m) return { type, id: m[1] };
  }
  return null;
}
