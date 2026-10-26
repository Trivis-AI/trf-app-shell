import * as React from "react";
import type { AiActionRequest, AiActionResult, AiPageDeclaration } from "./protocol";
import type { AiPageDeclared } from "./pageCompose";

/*
 * Pages tell the AI panel what they show (documentation/AI-SIDEPANEL-PLAN.md, 3.6):
 *
 *   useAiPageContext({ page: "purchase-invoices", list: { type: "purchase_invoice", filters, visibleIds, total },
 *                      selected: selectedIds.length ? { type: "purchase_invoice", ids: selectedIds } : undefined })
 *
 * The shell adds the app, the route and a version, debounces the result into the panel's
 * `context` message, and answers the panel's send-time `context-request` from the latest
 * committed declaration, so a reselect right before send is what the AI gets. Ids and
 * filter values only, never row data. Outside the shell the hook is a no-op.
 */

export interface AiPageStore {
  /** The latest committed declaration, read at send time for the snapshot. */
  current: { value: AiPageDeclared | null };
  set: (d: AiPageDeclared | null) => void;
  /** Called on every change; the host debounces the `context` message off it. */
  subscribe: (fn: () => void) => () => void;
}

export function createPageStore(): AiPageStore {
  const current = { value: null as AiPageDeclared | null };
  const listeners = new Set<() => void>();
  return {
    current,
    set: (d) => {
      current.value = d;
      for (const fn of listeners) fn();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/*
 * Pages also say what they can do for the panel (plan 3.8): a handler per action type,
 * registered with useAiPageActions. When the panel posts `action-request` for a type the
 * current page registered, the host runs that handler; the handler shows the page's own
 * dialog, the person decides there under their own token, and the promise resolves with
 * the outcome per record, which the host posts back as `action-result`. The registered
 * types travel in the context (`actions`), so the panel knows what this page offers.
 */

export type AiActionHandler = (request: AiActionRequest) => Promise<AiActionResult>;

export interface AiActionEntry {
  type: string;
  /** The host pathname the page registered on; a request on another page does not reach it. */
  pathname: string;
  run: AiActionHandler;
}

export interface AiActionStore {
  current: { value: AiActionEntry[] };
  /** Adds entries; returns the function that removes those same entries again. */
  register: (entries: AiActionEntry[]) => () => void;
  /** Called on every change; the host sends a fresh `context` off it. */
  subscribe: (fn: () => void) => () => void;
}

export function createActionStore(): AiActionStore {
  const current = { value: [] as AiActionEntry[] };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const fn of listeners) fn();
  };
  return {
    current,
    register: (entries) => {
      current.value = [...current.value, ...entries];
      notify();
      return () => {
        current.value = current.value.filter((e) => !entries.includes(e));
        notify();
      };
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The entry that answers `type` on `pathname`: the latest registration wins. */
export function findAction(entries: ReadonlyArray<AiActionEntry>, type: string, pathname: string | undefined): AiActionEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === type && e.pathname === pathname) return e;
  }
  return null;
}

const PageStoreContext = React.createContext<AiPageStore | null>(null);
const ActionStoreContext = React.createContext<AiActionStore | null>(null);

export function AiPageContextProvider({ store, actions, children }: { store: AiPageStore; actions?: AiActionStore; children: React.ReactNode }) {
  return (
    <PageStoreContext.Provider value={store}>
      <ActionStoreContext.Provider value={actions ?? null}>{children}</ActionStoreContext.Provider>
    </PageStoreContext.Provider>
  );
}

/**
 * Registers what this page can do for the AI panel: an async handler per action type,
 * e.g. `{ approve_purchase_invoices: (req) => openDialog(req) }`. The handler receives the
 * records and the AI's proposal for each, shows the page's own dialog and resolves with the
 * outcome per record (`{ status: "done", items }`, or `{ status: "cancelled" }`). Pass null
 * while the page cannot act (no token yet). Handlers are read at call time, so a new
 * function on every render costs nothing; the set of types is what registers. Dropped when
 * the page unmounts. Outside the shell the hook is a no-op.
 */
export function useAiPageActions(handlers: Record<string, AiActionHandler> | null | undefined): void {
  const store = React.useContext(ActionStoreContext);
  const latest = React.useRef(handlers);
  latest.current = handlers;
  const key = handlers ? Object.keys(handlers).sort().join(",") : "";
  React.useEffect(() => {
    if (!store || !key) return;
    const pathname = window.location.pathname;
    const entries: AiActionEntry[] = key.split(",").map((type) => ({
      type,
      pathname,
      run: (request) => {
        const h = latest.current?.[type];
        return h ? h(request) : Promise.resolve({ status: "unsupported" as const });
      },
    }));
    return store.register(entries);
  }, [store, key]);
}

/**
 * Declares what this page shows. Pass null while the page has nothing to say (loading).
 * Compared by value, so a fresh array of the same ids on every render costs nothing. One
 * declaration per page: with two, the later one wins. The declaration is tagged with the
 * pathname it was made on and dropped when the page unmounts, so a page that was just left
 * never describes the next one.
 */
export function useAiPageContext(declaration: AiPageDeclaration | null | undefined): void {
  const store = React.useContext(PageStoreContext);
  const key = declaration ? JSON.stringify(declaration) : "";
  React.useEffect(() => {
    if (!store) return;
    if (!key) {
      store.set(null);
      return;
    }
    const d = JSON.parse(key) as AiPageDeclaration;
    store.set({ ...d, pathname: window.location.pathname });
    return () => {
      store.set(null);
    };
  }, [store, key]);
}
