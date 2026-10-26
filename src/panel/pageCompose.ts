// The page as the panel hears it: the route (pageEntity.ts) merged with what the page
// declared about itself through useAiPageContext (pageContext.tsx). Pure and import-free,
// so it is node-tested; the host calls it for the debounced `context` message and again,
// at send time, for the `context-snapshot` answer. Plan: documentation/AI-SIDEPANEL-PLAN.md 3.6.

import type { AiPageContext, AiPageDeclaration, AiPageEntity } from "./protocol";

/** A declaration with the host pathname it was made on. */
export interface AiPageDeclared extends AiPageDeclaration {
  pathname: string;
}

export interface ComposeInput {
  appId: string | undefined;
  /** The host's full pathname, with the org prefix. */
  pathname: string | undefined;
  /** The route without the org prefix (pageEntity.ts `pagePath`). */
  path: string;
  /** What the route table says the page shows (pageEntity.ts `pageEntityFromPath`). */
  routeEntity: AiPageEntity | null;
  declared: AiPageDeclared | null;
}

/**
 * Composes the context without its version. A declaration made on another pathname is
 * ignored: a page that has just been left must not describe the page that replaced it,
 * whatever order the two pages' effects ran in. An empty selection is no selection, so it
 * is left out, and a declared entity wins over the route's guess.
 */
export function composePageContext(input: ComposeInput): Omit<AiPageContext, "version"> | null {
  const { appId, pathname, path, routeEntity, declared } = input;
  if (!appId || pathname === undefined) return null;
  const d = declared && declared.pathname === pathname ? declared : null;
  const entity = d?.entity ?? routeEntity ?? undefined;
  const ctx: Omit<AiPageContext, "version"> = { app: appId, path };
  if (entity) ctx.entity = entity;
  if (d?.page) ctx.page = d.page;
  if (d?.list) ctx.list = d.list;
  if (d?.selected && d.selected.ids.length > 0) ctx.selected = d.selected;
  return ctx;
}
