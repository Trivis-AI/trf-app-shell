import { useEffect } from "react";

import { isStagingHost } from "./environment";

/*
 * The tab title.
 *
 * Every app used to ship one static <title> in its index.html and never touch
 * it again, so "TRF Invoices" named the invoice list, one invoice, and the same
 * list opened in a different org. People here keep a tab per client open on the
 * same handful of screens, which makes the org the one fact that tells two tabs
 * apart, and it was the one fact missing. Bookmarks had the same problem in a
 * worse form: a bookmark bar full of "TRF Invoices" is a bookmark bar you stop
 * using.
 *
 * Org first, because browsers truncate the end of a title. Whatever leads is
 * what survives in a tab strip and in a bookmark bar; whatever trails is
 * decoration for the few places that show a title in full.
 *
 *   Acme OÜ · Sales › Invoices › PI-2024-0042 · Trivis AI Accounting
 *
 * This is also the only writer of document.title in the suite, which is why the
 * staging prefix is applied here rather than restored by an observer watching
 * for someone else's writes.
 */

/** Brand, so the same in every locale. The path segments are localized. */
const PRODUCT = "Trivis AI Accounting";
const SEGMENT_SEP = " · ";
/** The glyph the sidebar search trail already uses for a menu path. */
const PATH_SEP = " › ";
const STAGING_PREFIX = "[STAGING] ";

export interface DocumentTitleParts {
  /** Null until the org token mints. Omitted rather than rendered as a blank. */
  orgName?: string | null;
  /** Menu path to the current page, outermost first: ["Sales", "Invoices"]. */
  path?: (string | null | undefined)[];
}

/**
 * Drops a segment identical to the one before it. The discovery menu has
 * groups whose leaf repeats the group label (Contracts › Contracts), which
 * reads as a stutter in a title even though it is unremarkable in a tree.
 */
function collapseRepeats(segments: string[]): string[] {
  return segments.filter(
    (s, i) => i === 0 || s.toLowerCase() !== segments[i - 1].toLowerCase(),
  );
}

export function buildDocumentTitle({ orgName, path = [] }: DocumentTitleParts): string {
  const trail = collapseRepeats(
    path.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()),
  );
  const segments = [orgName?.trim() || null, trail.join(PATH_SEP) || null, PRODUCT];
  return (
    (isStagingHost() ? STAGING_PREFIX : "") +
    segments.filter((s): s is string => !!s).join(SEGMENT_SEP)
  );
}

/**
 * Keeps document.title in sync with the current org and menu path. The effect
 * depends on the built string rather than on the parts, so the caller is free
 * to pass a fresh array every render.
 */
export function useDocumentTitle(parts: DocumentTitleParts): void {
  const title = buildDocumentTitle(parts);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
