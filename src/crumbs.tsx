import * as React from "react";

/*
 * Shell breadcrumb tail-crumb registry.
 *
 * The shell derives "App > Section" from the discovery menu on its own; pages
 * that are deeper than a section (detail/edit views) publish their tail crumb
 * by rendering <ShellCrumb label="PI-2024-0042" /> anywhere below the shell.
 * Crumbs unregister on unmount, so navigating away clears them automatically.
 */

export interface ShellCrumbEntry {
  label: string;
  /** Internal route to navigate to when the crumb is clicked. Omit on the last crumb. */
  href?: string;
}

interface CrumbRegistry {
  crumbs: { id: string; crumb: ShellCrumbEntry }[];
  register: (id: string, crumb: ShellCrumbEntry) => void;
  unregister: (id: string) => void;
}

const ShellCrumbsContext = React.createContext<CrumbRegistry | null>(null);

export function ShellCrumbsProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = React.useState<{ id: string; crumb: ShellCrumbEntry }[]>([]);

  const register = React.useCallback((id: string, crumb: ShellCrumbEntry) => {
    setCrumbs((prev) => {
      const existing = prev.find((c) => c.id === id);
      if (existing && existing.crumb.label === crumb.label && existing.crumb.href === crumb.href) return prev;
      // Keyed upsert preserves insertion order across label updates.
      return existing
        ? prev.map((c) => (c.id === id ? { id, crumb } : c))
        : [...prev, { id, crumb }];
    });
  }, []);

  const unregister = React.useCallback((id: string) => {
    setCrumbs((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const value = React.useMemo(() => ({ crumbs, register, unregister }), [crumbs, register, unregister]);
  return <ShellCrumbsContext.Provider value={value}>{children}</ShellCrumbsContext.Provider>;
}

/** The registered tail crumbs, in mount order. Empty outside the shell or when no page crumb is set. */
export function useShellCrumbs(): ShellCrumbEntry[] {
  const ctx = React.useContext(ShellCrumbsContext);
  return React.useMemo(() => (ctx ? ctx.crumbs.map((c) => c.crumb) : []), [ctx]);
}

/**
 * Renders nothing; publishes a tail crumb to the shell top bar while mounted.
 * No-op when rendered outside AppShellLayout (e.g. in tests).
 */
export function ShellCrumb({ label, href }: ShellCrumbEntry): null {
  const ctx = React.useContext(ShellCrumbsContext);
  // register/unregister are useCallback-stable; depending on them (not ctx,
  // whose identity changes with every registry update) keeps these effects
  // from re-running on unrelated crumb changes.
  const register = ctx?.register;
  const unregister = ctx?.unregister;
  const id = React.useId();

  React.useLayoutEffect(() => {
    register?.(id, { label, href });
  }, [register, id, label, href]);

  // Unregister only on unmount, so label updates keep the crumb's position.
  React.useLayoutEffect(() => {
    if (!unregister) return;
    return () => unregister(id);
  }, [unregister, id]);

  return null;
}
