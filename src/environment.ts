import { useEffect } from "react";

/*
 * Telling the two clusters apart.
 *
 * trf.is (staging) and trivis.ee (production) serve the same bundle from the
 * same code, so once you are past the login page they are pixel-identical —
 * same layout, same org name, same "TRF Invoices" tab title. People working in
 * both keep tabs open in both, and act on staging data believing it is
 * production. The only tell is the address bar, which is exactly what nobody
 * reads.
 *
 * So the marks go where a tab-switcher actually looks: the favicon and the tab
 * title, plus a chip in the shell for once you are on the page. Production is
 * left completely unmarked — the normal case should not carry decoration, and
 * anything shown everywhere stops being read.
 */

/** True on a real *.trf.is host. Localhost dev is not staging. */
export function isStagingHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("trf.is");
}

const TITLE_PREFIX = "[STAGING] ";

/**
 * Prefixes the tab title on staging, and keeps it prefixed when the app
 * rewrites the title on navigation. The observer is cheap (title changes are
 * rare) and guarded against reacting to its own write.
 */
export function useStagingTitle(): void {
  useEffect(() => {
    if (!isStagingHost()) return;

    const apply = () => {
      if (!document.title.startsWith(TITLE_PREFIX)) {
        document.title = TITLE_PREFIX + document.title;
      }
    };
    apply();

    const titleEl = document.querySelector("title");
    if (!titleEl) return;
    const observer = new MutationObserver(apply);
    observer.observe(titleEl, { childList: true });
    return () => observer.disconnect();
  }, []);
}
