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
 *
 * The title half of that lives in title.ts. It used to be a MutationObserver
 * here, re-applying a "[STAGING] " prefix in case an app rewrote the title on
 * navigation; now that the shell composes the whole title in one place, the
 * prefix is simply part of what it composes.
 */

/** True on a real *.trf.is host. Localhost dev is not staging. */
export function isStagingHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname.endsWith("trf.is");
}
