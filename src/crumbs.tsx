import * as React from "react";
import { createPortal } from "react-dom";

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
  /** Right-side actions container of the desktop bar; ShellBarActions portals into it. */
  actionsEl: HTMLElement | null;
  setActionsEl: (el: HTMLElement | null) => void;
  /** The meta pill (status/meta) under the bar; ShellBarMeta portals into it. */
  metaEl: HTMLElement | null;
  setMetaEl: (el: HTMLElement | null) => void;
  /** Pages that asked the desktop bar to scroll away; ShellBarUnpinned registers here. */
  unpinned: IdSet;
  /** Pages that asked for no desktop bar at all; ShellBarHidden registers here. */
  hidden: IdSet;
}

/** The ids of the mounted pages holding a bar flag (unpinned, hidden). */
interface IdSet {
  ids: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
}

function useIdSet(): IdSet {
  const [ids, setIds] = React.useState<string[]>([]);
  const add = React.useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);
  const remove = React.useCallback((id: string) => {
    setIds((prev) => prev.filter((x) => x !== id));
  }, []);
  return React.useMemo(() => ({ ids, add, remove }), [ids, add, remove]);
}

const ShellCrumbsContext = React.createContext<CrumbRegistry | null>(null);

export function ShellCrumbsProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = React.useState<{ id: string; crumb: ShellCrumbEntry }[]>([]);
  const [actionsEl, setActionsEl] = React.useState<HTMLElement | null>(null);
  const [metaEl, setMetaEl] = React.useState<HTMLElement | null>(null);

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

  const unpinned = useIdSet();
  const hidden = useIdSet();

  const value = React.useMemo(
    () => ({ crumbs, register, unregister, actionsEl, setActionsEl, metaEl, setMetaEl, unpinned, hidden }),
    [crumbs, register, unregister, actionsEl, metaEl, unpinned, hidden],
  );
  return <ShellCrumbsContext.Provider value={value}>{children}</ShellCrumbsContext.Provider>;
}

/** Internal: the desktop bar registers its slot containers here. */
export function useShellBarSlots() {
  const ctx = React.useContext(ShellCrumbsContext);
  return { setActionsEl: ctx?.setActionsEl, setMetaEl: ctx?.setMetaEl };
}

/**
 * Portals its children into the right side of the shell's desktop breadcrumb
 * bar (same row as the crumbs). The bar is desktop-only (hidden below md), so
 * pages should render a `md:hidden` fallback for the same actions.
 */
export function ShellBarActions({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(ShellCrumbsContext);
  if (!ctx?.actionsEl) return null;
  return createPortal(children, ctx.actionsEl);
}

/**
 * Portals its children into a pill under the shell's desktop bar (status
 * badges, meta text). Lead with the status badge: it sits concentric in the
 * pill. Desktop-only, like ShellBarActions.
 */
export function ShellBarMeta({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(ShellCrumbsContext);
  if (!ctx?.metaEl) return null;
  return createPortal(children, ctx.metaEl);
}

/** Internal: true while no mounted page has asked the desktop bar to scroll away. */
export function useShellBarPinned(): boolean {
  const ctx = React.useContext(ShellCrumbsContext);
  return !ctx || ctx.unpinned.ids.length === 0;
}

/** Internal: true while a mounted page has asked for no desktop bar. */
export function useShellBarHidden(): boolean {
  const ctx = React.useContext(ShellCrumbsContext);
  return !!ctx && ctx.hidden.ids.length > 0;
}

// Holds the page's id in a bar flag set while the calling component is mounted.
function useFlagWhileMounted(set: IdSet | undefined): void {
  const add = set?.add;
  const remove = set?.remove;
  const id = React.useId();
  React.useLayoutEffect(() => {
    if (!add || !remove) return;
    add(id);
    return () => remove(id);
  }, [add, remove, id]);
}

/**
 * Renders nothing; while mounted, the shell's desktop top bar scrolls away
 * with the page instead of staying pinned. For pages where the bar carries no
 * useful context and vertical space matters (e.g. full-page editors).
 * No-op outside AppShellLayout.
 */
export function ShellBarUnpinned(): null {
  useFlagWhileMounted(React.useContext(ShellCrumbsContext)?.unpinned);
  return null;
}

/**
 * Renders nothing; while mounted, the shell shows no desktop top bar (crumbs,
 * ShellBarActions, ShellBarMeta) at all. For pages that need none of it, e.g. the
 * AI chat. The mobile bar stays: it carries the menu toggle. No-op outside
 * AppShellLayout.
 */
export function ShellBarHidden(): null {
  useFlagWhileMounted(React.useContext(ShellCrumbsContext)?.hidden);
  return null;
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
