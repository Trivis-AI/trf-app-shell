// Landing redirect for an app's public root route (`/`).
//
// Before the per-org cookie cutover, every app found the org to open by reading the first
// `trf_jwt_<slug>` cookie it could see. Those cookies are now actively deleted on every
// load (`clearLegacyOrgCookies`), so that lookup always missed: a new tab opened on an app
// root fell through to the "please sign in" screen even though the account session cookie
// (`jwt_token`, HttpOnly, 30 days) was perfectly valid, and the login page has no
// already-signed-in check either, so the user re-typed a password for a live session.
//
// The org list is the durable source of truth instead. It is authenticated by the account
// cookie alone (credentials: "include"), so it answers both questions in one call: is there
// a session at all, and which org should this tab open.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/** Last org + app the user actually had open. These are apex-domain cookies rather than
 *  localStorage because localStorage is per-origin: the marketing site on the bare apex
 *  (trivis.ee) cannot read what invoices.trivis.ee wrote, and it needs exactly this to
 *  send an already-signed-in visitor onward instead of showing them the pre-login page.
 *  Same shape as the existing `trf-theme` / `trf-palette` cookies: constant size, so this
 *  does not reintroduce the per-org Cookie-header bloat that the cutover removed. */
const LAST_ORG_COOKIE = "trf_last_org";
const LAST_APP_COOKIE = "trf_last_app";
const REMEMBER_MAX_AGE = 31536000; // 1 year, matching the theme cookies

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  isSelected?: boolean;
}

function apexFor(sub: string): string {
  if (typeof window === "undefined") return `https://${sub}.trf.is`;
  const parts = window.location.hostname.split(".");
  const apex = parts.length >= 2 ? parts.slice(-2).join(".") : "trf.is";
  return `https://${sub}.${apex}`;
}

function apexDomainSuffix(): string {
  const parts = window.location.hostname.split(".");
  return parts.length >= 2 ? `; domain=.${parts.slice(-2).join(".")}` : "";
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Records the org (and the app) this tab is in, so both a later tab on a bare app root
 *  and the marketing site on the apex can reopen it. Called by AppShellLayout; apps do not
 *  need to call it themselves. */
export function rememberOrg(slug: string | null | undefined, appId?: string): void {
  if (!slug || typeof document === "undefined") return;
  const domain = apexDomainSuffix();
  document.cookie = `${LAST_ORG_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${REMEMBER_MAX_AGE}; samesite=lax${domain}`;
  if (appId) {
    document.cookie = `${LAST_APP_COOKIE}=${encodeURIComponent(appId)}; path=/; max-age=${REMEMBER_MAX_AGE}; samesite=lax${domain}`;
  }
}

/** The org slug this account last had open, or null. Readable from any host under the
 *  apex, including the bare apex itself. */
export function readLastOrg(): string | null {
  return readCookie(LAST_ORG_COOKIE);
}

/** The app id (e.g. "invoices") the account last had open, or null. */
export function readLastApp(): string | null {
  return readCookie(LAST_APP_COOKIE);
}

/** The org list arrives either bare or wrapped, depending on the endpoint version. */
function normalizeOrgs(data: unknown): OrgSummary[] {
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { organizations?: unknown })?.organizations)
      ? (data as { organizations: OrgSummary[] }).organizations
      : [];
  return arr.filter((o: OrgSummary) => !!o?.slug);
}

/** Last one open wins; then the server-side `is_selected` membership flag; then whatever
 *  is first (the list is sorted by name, so this is at least stable). Exported because the
 *  marketing site on the apex resolves the same way. */
function pickOrg(orgs: OrgSummary[]): OrgSummary {
  const last = readLastOrg();
  return (
    (last ? orgs.find((o) => o.slug === last) : undefined) ??
    orgs.find((o) => o.isSelected) ??
    orgs[0]
  );
}

export type OrgLandingStatus = "checking" | "signed-out";

export interface OrgLandingOptions {
  /** Override the login API base. Mainly for tests and local dev proxies. */
  apiBase?: string;
  /** Set false to hold the check back, for callers that have a reason to stay put (the
   *  login page does this when an invitee has an invite waiting to be resumed). Reports
   *  `"signed-out"` so the caller renders its normal content. Default true. */
  enabled?: boolean;
}

/**
 * Resolves which org this tab should open and redirects to `/app/<slug>/<section>`.
 *
 * Returns `"checking"` while the org list is in flight (render a blank frame, not the
 * sign-in screen — flashing "please sign in" at a signed-in user is the bug this fixes)
 * and `"signed-out"` when there is genuinely no session, at which point the app should
 * render its own sign-in screen. A signed-in account with no orgs yet is sent to the login
 * portal, which owns onboarding.
 *
 *   const status = useOrgLanding("invoices");
 *   if (status === "checking") return <div className="min-h-screen bg-background" />;
 *   return <SignInPrompt />;
 */
export function useOrgLanding(
  section?: string,
  opts: OrgLandingOptions = {},
): OrgLandingStatus {
  const navigate = useNavigate();
  const [status, setStatus] = useState<OrgLandingStatus>("checking");
  const { apiBase, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) {
      setStatus("signed-out");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const base = apiBase ?? apexFor("login-api");

    (async () => {
      let orgs: OrgSummary[];
      try {
        const res = await fetch(`${base}/v1/organization?tokens=false`, {
          credentials: "include",
          signal: controller.signal,
        });
        // 401 is the real "no session". Any other failure (5xx, offline) is not proof of
        // being signed out, but the sign-in screen is the only safe thing to show.
        if (!res.ok) {
          if (!cancelled) setStatus("signed-out");
          return;
        }
        orgs = normalizeOrgs(await res.json());
      } catch {
        if (!cancelled) setStatus("signed-out");
        return;
      }
      if (cancelled) return;

      if (orgs.length === 0) {
        window.location.href = apexFor("login");
        return;
      }
      const suffix = section ? `/${section.replace(/^\/+/, "")}` : "";
      navigate(`/app/${pickOrg(orgs).slug}${suffix}`, { replace: true });
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [navigate, section, apiBase, enabled]);

  return status;
}
