import * as React from "react";
import type { AiPageDeclaration } from "./protocol";
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

const PageStoreContext = React.createContext<AiPageStore | null>(null);

export function AiPageContextProvider({ store, children }: { store: AiPageStore; children: React.ReactNode }) {
  return <PageStoreContext.Provider value={store}>{children}</PageStoreContext.Provider>;
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
