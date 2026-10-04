import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Sparkles, BadgeDollarSign, Receipt, ReceiptText, Wallet, Package, ScrollText, PieChart, Handshake,
  Signature, CirclePile, Table2, Settings, ClipboardCheck, Network, Circle,
  Plus, LogOut, ChevronRight, ChevronsUpDown, Check, Globe, Menu, X, Search, User,
  House, Users, Gauge,
} from "lucide-react";
import {
  AppShell, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarTrigger, useSidebar,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Dialog, DialogContent, DialogTitle,
  Command, CommandInput, CommandList, CommandEmpty, CommandItem,
  Badge, Button, SearchInput, Avatar, Text, cn, OrgSwitcher, OrgTag,
} from "@trf/ui2";
import { clearLegacyOrgCookies, useRenewingOrgToken } from "@trf/ui2";
import { rememberOrg } from "./orgLanding";
import { fetchDiscoveryMenu, logout } from "@trf/ui";
import { useThemeFavicon } from "./favicon";
import { isStagingHost } from "./environment";
import { useDocumentTitle } from "./title";
import { useColorMode, usePalette } from "./appearance";
import { ShellCrumbsProvider, useShellCrumbs, useShellBarSlots, useShellBarPinned, useShellBarHidden } from "./crumbs";
import type { MenuItem, AppBaseUrls } from "@trf/ui";

/*
 * AppShellLayout — the shared TRF sidebar/menu shell.
 *
 * Graduated from the per-app `AppLayout.tsx` that was copy-pasted across every
 * frontend (identical except appId + brand label). Built on @trf/ui2 primitives;
 * reuses @trf/ui infra (discovery, logout, JWT) during the @trf/ui → ui2 migration.
 * Apps wrap their routed content:
 *
 *   <AppShellLayout appId="contracts" appLabel="Contracts" translation={t}>
 *     <Outlet />
 *   </AppShellLayout>
 */

/** Minimal translation surface — avoids coupling to @trf/ui's TranslationClient type. */
export interface TranslationLike {
  getLang(): string;
  setLang(lang: string): void;
}

/** A hover-reveal action rendered on a nav row (e.g. AI's "new chat" +). */
export interface ItemAction {
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}

export interface AppShellLayoutProps {
  /** This app's id (e.g. "ai", "contracts") — used for same-app route detection. */
  appId: string;
  /** Brand subtitle under the org name (e.g. "AI", "Contracts"). */
  appLabel: string;
  /** The app's live translation client (its `t` singleton). */
  translation: TranslationLike;
  /** Login portal base (e.g. https://login.trf.is) for logout redirect + "Organisation settings". Defaults from the current hostname. */
  loginUrl?: string;
  /** CORS-enabled API base (e.g. https://login-api.trf.is) for the org list. Defaults from the current hostname. */
  orgsApiUrl?: string;
  /** Optional per-row hover action; return null for rows without one. */
  itemAction?: (item: MenuItem, ctx: { href?: string; internal: boolean }) => ItemAction | null;
  /** Desktop breadcrumb top bar. Default true; disable for full-bleed screens. */
  topBar?: boolean;
  children: React.ReactNode;
}

/* color and tag mark an organization apart from another one carrying the same
   company name (a tenant migrated from another system and the live copy of it).
   Both are empty on every organization nobody has marked, and empty means the
   avatar keeps the colour hashed from the slug and no tag is drawn. */
interface OrgOption { id: string; name: string; slug: string; color?: string; tag?: string }

/* Opening another organization goes to the same place switching to it goes: the
   app root under its slug, not the current deep route, whose ids belong to the
   org you are leaving. */
const orgHrefFor = (org: { slug: string }) => `/app/${org.slug}`;

/* ── Menu search ──────────────────────────────────────────────────────────
 * Flattens the discovery menu to navigable leaves and matches a query against
 * each leaf's label + every localized label + (future) BE `keywords`. Lowercase
 * + diacritic-strip so "muuk" finds "Müük". Keyword-ready today: read via the
 * local `Searchable` cast so when the BE/@trf/ui add `keywords` it just works. */
type Searchable = MenuItem & { keywords?: string[] };

interface SearchLeaf {
  item: MenuItem;
  href?: string;
  internal: boolean;
  /** Ancestor group labels, e.g. ["Müük", "Arved"]. */
  trail: string[];
  /** Normalized haystack: label + labels[*] + keywords. */
  hay: string;
}

const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const queryTokens = (q: string) => normalize(q).split(/\s+/).filter(Boolean);

const matchesQuery = (hay: string, q: string) => {
  const tokens = queryTokens(q);
  return tokens.length > 0 && tokens.every((t) => hay.includes(t));
};

/** Bold the matched spans of `text` for a given query (cosmetic; length-preserving). */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = queryTokens(query);
  if (!tokens.length) return <>{text}</>;
  const chars = Array.from(text);
  // Per-code-point normalize, forced to one char, so indices map back to `chars`.
  const norm = chars
    .map((c) => {
      const n = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return n ? n[0] : (c.toLowerCase()[0] ?? c);
    })
    .join("");
  const ranges: [number, number][] = [];
  for (const tk of tokens) {
    let from = 0, idx: number;
    while ((idx = norm.indexOf(tk, from)) !== -1) {
      ranges.push([idx, idx + tk.length]);
      from = idx + tk.length;
    }
  }
  if (!ranges.length) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const parts: React.ReactNode[] = [];
  let cur = 0;
  merged.forEach(([s, e], i) => {
    if (s > cur) parts.push(chars.slice(cur, s).join(""));
    parts.push(<mark key={i} className="bg-transparent font-semibold text-foreground">{chars.slice(s, e).join("")}</mark>);
    cur = e;
  });
  if (cur < chars.length) parts.push(chars.slice(cur).join(""));
  return <>{parts}</>;
}

/** Inline filter box at the top of the menu. On the collapsed rail it becomes a
 * single search icon button that opens the ⌘K palette (no room for an input). */
function MenuSearchBox({
  query, setQuery, onOpenPalette, onKeyDown,
}: {
  query: string;
  setQuery: (v: string) => void;
  onOpenPalette: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const { collapsed } = useSidebar();
  if (collapsed) {
    return (
      <div className="flex justify-center px-2 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onOpenPalette}
          aria-label="Search menu"
          title="Search (⌘K)"
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <Search />
        </Button>
      </div>
    );
  }
  return (
    <div className="px-2 pb-1 max-md:px-1">
      <SearchInput
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        onKeyDown={onKeyDown}
        placeholder="Search…"
        aria-label="Search menu"
        className="h-9 bg-sidebar-field focus-visible:bg-sidebar-field-focus max-md:h-11 max-md:text-base"
      />
    </div>
  );
}

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ee", label: "Eesti" },
  { code: "lv", label: "Latviešu" },
  { code: "lt", label: "Lietuvių" },
];

// Org-switcher texts per shell language (the shell has no t() surface; static
// strings are lang-keyed here, like menu labels are in the discovery payload).
const ORG_SWITCHER_TEXTS: Record<string, { search: string; empty: string }> = {
  en: { search: "Search organisations…", empty: "No organisation found." },
  ee: { search: "Otsi organisatsiooni…", empty: "Organisatsiooni ei leitud." },
  lv: { search: "Meklēt organizāciju…", empty: "Organizācija nav atrasta." },
  lt: { search: "Ieškoti organizacijos…", empty: "Organizacija nerasta." },
};

// The plan line under the org name: the plan, and this month's use of it.
const PLAN_TEXTS: Record<string, { free: string; standard: string; premium: string; usage: string }> = {
  en: { free: "Free", standard: "Standard", premium: "Premium", usage: "Usage" },
  ee: { free: "Tasuta", standard: "Standard", premium: "Premium", usage: "Kasutus" },
  lv: { free: "Bezmaksas", standard: "Standarta", premium: "Premium", usage: "Lietojums" },
  lt: { free: "Nemokamas", standard: "Standartinis", premium: "Premium", usage: "Naudojimas" },
};

/** What the org header shows under the name: the plan, and the share of the plan's
 *  monthly tokens used since the 1st (null when backlogin does not send usage). */
type PlanLine = { plan: string; usedPct: number | null };

// The plan line is refetched on window focus; switching tabs back and forth should not
// cost a backlogin and trfservices round trip every time.
const PLAN_REFRESH_MIN_MS = 60_000;

// Keyed by the node's English label, lower-cased — not by id — so a key that does not
// match a label exactly is silently dead and the row falls back to Circle. "items" was
// dead for exactly that reason: the menu calls that group "Assets and warehouse".
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "oto ai": Sparkles, ai: Sparkles, sales: BadgeDollarSign, purchase: Receipt, payments: Wallet,
  products: Package, ledger: ScrollText, reports: PieChart, crm: Handshake,
  contracts: Signature, "assets and warehouse": CirclePile, tables: Table2, settings: Settings,
  personnel: Users,
  // Member-role menu only, which is why these two went unnoticed. "Invoicing" holds both
  // sales and purchase invoices, so it takes neither Sales' nor Purchase's icon; "Contacts"
  // is crm-home under a different label, so it shares CRM's.
  invoicing: ReceiptText, contacts: Handshake,
  // "my account" is the pre-2026-08 label for the same portal group; keep it so a
  // browser holding an older cached menu still gets an icon rather than the fallback.
  audit: ClipboardCheck, organizations: Network, "my account": User, "my trivis": House,
};

const joinUrl = (base: string, path: string) =>
  `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

const injectSlug = (p: string | undefined, slug?: string): string | undefined => {
  if (!slug || !p) return p;
  if (p.includes("://")) {
    const i = p.indexOf("/app/");
    return i === -1 ? p : p.slice(0, i) + `/app/${slug}/` + p.slice(i + 5);
  }
  if (p === "/app" || p === "/app/") return `/app/${slug}`;
  if (p.startsWith("/app/")) return `/app/${slug}/${p.slice(5)}`;
  return p;
};

function jwtToken(): string | null {
  const m = document.cookie.match(/(?:^|; )jwt_token=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Decode a JWT payload as UTF-8 (base64url) — plain atob mangles non-ASCII names
// like "OÜ".
function decodeJwtPayload(token: string): { o?: { n?: string } } {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}


function apexFor(sub: string): string {
  if (typeof window === "undefined") return `https://${sub}.trf.is`;
  const parts = window.location.hostname.split(".");
  const apex = parts.length >= 2 ? parts.slice(-2).join(".") : "trf.is";
  return `https://${sub}.${apex}`;
}
const defaultLoginUrl = () => apexFor("login");      // user-facing portal
const defaultLoginApiUrl = () => apexFor("login-api"); // CORS-enabled API

/** Re-render when the language changes (TranslationClient.setLang dispatches this). */
function useLangVersion(): void {
  const [, setV] = useState(0);
  useEffect(() => {
    const h = () => setV((v) => v + 1);
    window.addEventListener("trf:lang-changed", h);
    return () => window.removeEventListener("trf:lang-changed", h);
  }, []);
}

function SidebarBrandInner({ orgName, appLabel, colorKey, color, tag, planLine, lang }: { orgName: string | null; appLabel: string; colorKey?: string; color?: string; tag?: string; planLine?: PlanLine | null; lang: string }) {
  const { collapsed } = useSidebar();
  // Under the name: the plan and this month's use of it ("Standard  Usage 58%"), once
  // loaded; the app label while loading or when billing does not answer.
  const texts = PLAN_TEXTS[lang] ?? PLAN_TEXTS.en;
  const planName = planLine ? (texts[planLine.plan as "free" | "standard" | "premium"] ?? planLine.plan) : null;
  const subtitle = planLine ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate">{planName}</span>
      {planLine.usedPct != null && (
        <>
          <Gauge className="size-3.5 shrink-0" aria-hidden />
          <span className="shrink-0 tabular-nums">{texts.usage} {planLine.usedPct}%</span>
        </>
      )}
    </span>
  ) : appLabel;
  // h-14 matches the desktop breadcrumb bar (min-h-14), so the two bottom borders line up.
  return (
    <div className="flex h-14 w-full items-center gap-2 overflow-hidden px-4">
      <Avatar name={orgName} colorKey={colorKey} color={color} size={28} className="shrink-0" />
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 overflow-hidden transition-[max-width,opacity] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[12rem] opacity-100",
        )}
      >
        <div className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center gap-1.5">
            <Text as="span" size="sm" weight="semibold" className="min-w-0 truncate leading-tight">{orgName ?? "TRF"}</Text>
            {tag && <OrgTag color={color} colorKey={colorKey} name={orgName}>{tag}</OrgTag>}
          </div>
          <Text as="span" size="xs" tone="muted" className="block truncate">{subtitle}</Text>
        </div>
        {/* Desktop-only org-switcher affordance (mobile uses the breadcrumb). */}
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </div>
  );
}

interface OrgPickerProps {
  orgs: OrgOption[];
  currentSlug?: string;
  onSelect: (slug: string) => void;
  onOpen: () => void;
  searchPlaceholder: string;
  emptyText: string;
}

// Desktop brand header — the whole block is the org-picker trigger (no chevron;
// tapping the org name opens the picker). The picker is ui2's OrgSwitcher: search
// appears automatically past its threshold, type-to-filter + Enter switches.
function SidebarBrand({ orgName, appLabel, planLine, lang, ...org }: { orgName: string | null; appLabel: string; planLine?: PlanLine | null; lang: string } & OrgPickerProps) {
  const { setMobileOpen } = useSidebar();
  // The list arrives asynchronously, so before it lands there are no marks and the
  // brand renders exactly as it did before they existed.
  const current = org.orgs.find((o) => o.slug === org.currentSlug);
  const inner = (
    <SidebarBrandInner
      orgName={orgName}
      appLabel={appLabel}
      colorKey={org.currentSlug}
      color={current?.color}
      tag={current?.tag}
      planLine={planLine}
      lang={lang}
    />
  );
  // Single org → nothing to switch to, so the brand is static (no dropdown).
  if (org.orgs.length <= 1) return <div className="w-full">{inner}</div>;
  return (
    <OrgSwitcher
      orgs={org.orgs}
      currentSlug={org.currentSlug}
      onOpen={org.onOpen}
      onSelect={(o) => { setMobileOpen(false); org.onSelect(o.slug); }}
      orgHref={orgHrefFor}
      searchPlaceholder={org.searchPlaceholder}
      emptyText={org.emptyText}
      // Open 4px into the header: just under the inset hover block, and over the top
      // edge of the menu search, which starts right where the header ends.
      sideOffset={-4}
    >
      {/* The hover is a rounded block inset 8px from the button's edges; the button
          itself keeps the header's full size. */}
      <button
        type="button"
        className="relative isolate w-full before:absolute before:inset-2 before:-z-10 before:rounded-md before:transition-colors hover:before:bg-muted"
      >
        {inner}
      </button>
    </OrgSwitcher>
  );
}

// Nearest ancestor that scrolls vertically (the SidebarInset for the top bars).
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let sc = el?.parentElement ?? null;
  while (sc) {
    const oy = getComputedStyle(sc).overflowY;
    if (oy === "auto" || oy === "scroll") return sc;
    sc = sc.parentElement;
  }
  return null;
}

// Hide the top bar when scrolling down its scroll container, show it on scroll up.
// Returns a ref to attach to the bar and whether it should be hidden.
function useHideOnScroll(enabled?: boolean): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const target = scrollParent(ref.current);
    if (!target) return;
    let last = target.scrollTop;
    const onScroll = () => {
      const y = target.scrollTop;
      const d = y - last;
      if (Math.abs(d) < 6) return;
      setHidden(d > 0 && y > 56);
      last = y;
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [enabled]);
  return [ref, hidden];
}

// Whether content has scrolled under the bar, for its shadow. That is the inset itself
// scrolling, or a page's own scroll box sitting flush under the bar (AI chat's message
// list). Scroll events don't bubble, so the inset listens in the capture phase.
function useScrolledUnder(ref: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    const bar = ref.current;
    const inset = enabled ? scrollParent(bar) : null;
    if (!bar || !inset) {
      setScrolled(false);
      return;
    }
    setScrolled(inset.scrollTop > 0);
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t === inset) return setScrolled(inset.scrollTop > 0);
      if (!(t instanceof HTMLElement)) return;
      if (Math.abs(t.getBoundingClientRect().top - bar.getBoundingClientRect().bottom) > 1) return;
      setScrolled(inset.scrollTop > 0 || t.scrollTop > 0);
    };
    inset.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => inset.removeEventListener("scroll", onScroll, { capture: true });
  }, [ref, enabled, pathname]);
  return scrolled;
}

// The single menu toggle (☰ when closed, ✕ when open). Living in the breadcrumb bar
// — which renders in both states — keeps it pixel-aligned across open/close.
function MobileToggle() {
  const { mobileOpen, setMobileOpen } = useSidebar();
  return (
    <button
      type="button"
      aria-label={mobileOpen ? "Close menu" : "Open menu"}
      aria-expanded={mobileOpen}
      onClick={() => setMobileOpen(!mobileOpen)}
      className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-6"
    >
      {mobileOpen ? <X /> : <Menu />}
    </button>
  );
}

// Unified mobile bar (breadcrumb + toggle). Rendered identically as the closed-state
// top bar and as the open drawer's header, so the two states are seamless. The org
// name is the org-picker trigger (no chevron). Height matches the footer (min-h-14).
function MobileBar({
  orgName, appLabel, section, scrollHide, ...org
}: { orgName: string | null; appLabel: string; section: string | null; scrollHide?: boolean } & OrgPickerProps) {
  const Sep = () => <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />;
  const [ref, hidden] = useHideOnScroll(scrollHide);
  const { setMobileOpen } = useSidebar();
  const current = org.orgs.find((o) => o.slug === org.currentSlug);
  return (
    <div
      ref={ref}
      className={cn(
        // Safe-area reserved on top, then equal 0.5rem padding above/below content.
        "sticky top-0 z-30 flex min-h-14 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:hidden",
        scrollHide && "transition-transform duration-200 ease-out",
        scrollHide && hidden && "-translate-y-full",
      )}
    >
      <Avatar name={orgName} colorKey={org.currentSlug} color={current?.color} size={24} className="shrink-0" />
      <StagingChip />
      <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        {org.orgs.length <= 1 ? (
          <span className="min-w-0 truncate font-medium">{orgName ?? "TRF"}</span>
        ) : (
          <OrgSwitcher
            orgs={org.orgs}
            currentSlug={org.currentSlug}
            onOpen={org.onOpen}
            onSelect={(o) => { setMobileOpen(false); org.onSelect(o.slug); }}
            orgHref={orgHrefFor}
            searchPlaceholder={org.searchPlaceholder}
            emptyText={org.emptyText}
          >
            <button type="button" className="min-w-0 truncate font-medium outline-none hover:opacity-80">
              {orgName ?? "TRF"}
            </button>
          </OrgSwitcher>
        )}
        {current?.tag && (
          <OrgTag color={current.color} colorKey={org.currentSlug} name={orgName}>{current.tag}</OrgTag>
        )}
        <Sep />
        <span className="shrink-0 text-muted-foreground">{appLabel}</span>
        {section && (<><Sep /><span className="min-w-0 truncate font-medium">{section}</span></>)}
      </div>
      <MobileToggle />
    </div>
  );
}

// Desktop breadcrumb top bar: app label > active menu section > page-provided
// tail crumbs (ShellCrumb). Persistent (no scroll-hide); the org identity lives
// in the sidebar brand, so unlike MobileBar there is no avatar/org switcher here.
// The section links back to its list route only when tail crumbs exist, which
// is what replaces the per-page inline "Back" links.
/**
 * Environment mark, rendered only on staging. Amber rather than destructive
 * red: being on staging is not an error, it is a fact worth noticing, and a red
 * banner on every screen of a working environment is noise people learn to
 * ignore within a day.
 *
 * It sits in the bar rather than floating over the page because it has to
 * survive scrolling without ever covering content.
 */
function StagingChip({ className }: { className?: string }) {
  if (!isStagingHost()) return null;
  return (
    <Badge
      variant="warning"
      title="Staging environment (trf.is) — not production data"
      className={cn("shrink-0 uppercase tracking-wider", className)}
    >
      Staging
    </Badge>
  );
}

/**
 * Renders nothing; owns the tab title while mounted.
 *
 * It sits inside ShellCrumbsProvider because that is the only place
 * useShellCrumbs() can see the tail crumb a detail page publishes:
 * AppShellLayout's own body *renders* the provider, so a call up there reads an
 * empty registry no matter what the page did.
 */
function DocumentTitle({ orgName, path }: { orgName: string | null; path: string[] }) {
  const crumbs = useShellCrumbs();
  useDocumentTitle({ orgName, path: [...path, ...crumbs.map((c) => c.label)] });
  return null;
}

type DesktopBarProps = { appLabel: string; section: string | null; onSection: () => void };

// The desktop bar, unless the page asked for none (ShellBarHidden). Its own component
// so the check runs inside ShellCrumbsProvider.
function DesktopBarUnlessHidden(props: DesktopBarProps) {
  return useShellBarHidden() ? null : <DesktopBar {...props} />;
}

function DesktopBar({ appLabel, section, onSection }: DesktopBarProps) {
  const crumbs = useShellCrumbs();
  const { setActionsEl, setMetaEl } = useShellBarSlots();
  const pinned = useShellBarPinned();
  const navigate = useNavigate();
  const Sep = () => <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />;
  const crumbLink = "min-w-0 truncate text-muted-foreground outline-none transition-colors hover:text-foreground";

  // Publish the bar's height as --trf-topbar-h so sticky page elements (ui2's
  // sticky table headers) can pin themselves right below it. display:none on
  // mobile measures as 0, which is correct there. An unpinned bar scrolls away,
  // so those elements should pin to the viewport top: publish 0.
  const barRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--trf-topbar-h", pinned ? `${el.offsetHeight}px` : "0px");
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--trf-topbar-h");
    };
  }, [pinned]);
  const scrolled = useScrolledUnder(barRef, pinned);

  return (
    <div
      ref={barRef}
      className={cn(
        "z-30 hidden shrink-0 flex-col bg-card transition-shadow duration-200 md:flex",
        // With the meta pill showing, keep the page's content off it: a margin, so it
        // scrolls away instead of making the pinned bar taller.
        "has-[[data-shell-meta]:not(:empty)]:mb-4",
        pinned && "sticky top-0",
        scrolled && "shadow-md",
      )}
    >
      {/* No bottom border, like the sidebar's brand header beside it: both are
          56px tall. The row only grows if the page's actions wrap on a narrow window. */}
      <div className="flex min-h-14 items-center gap-1.5 px-6 py-2 text-sm">
        <StagingChip className="mr-1" />
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-muted-foreground">{appLabel}</span>
          {section && (
            <>
              <Sep />
              {/* Always a link: on the section's own page it navigates back to the
                  bare list route, which doubles as a reset of search/filter params. */}
              <button
                type="button"
                aria-current={crumbs.length === 0 ? "page" : undefined}
                className={crumbs.length > 0
                  ? crumbLink
                  : "min-w-0 truncate font-medium outline-none transition-opacity hover:opacity-70"}
                onClick={onSection}
              >
                {section}
              </button>
            </>
          )}
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <React.Fragment key={`${i}-${crumb.label}`}>
                <Sep />
                {!last && crumb.href ? (
                  <button type="button" className={crumbLink} onClick={() => navigate(crumb.href!)}>
                    {crumb.label}
                  </button>
                ) : (
                  <span aria-current={last ? "page" : undefined} className="min-w-0 truncate font-medium">
                    {crumb.label}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </nav>
        {/* ShellBarActions portal target; empty and invisible when unused. */}
        <div ref={setActionsEl} className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 [&:empty]:hidden" />
      </div>
      {/* ShellBarMeta portal target: a pill (bg-sunken, ui2 >= v7.11.0) under the
          bar rather than a second bar row, so the bar keeps its height. The row is
          opaque page background because it stays pinned with the bar and content
          scrolls under it.
          4px padding keeps a leading or trailing badge concentric with the pill,
          and px-5 plus that padding puts it on the page's 24px content edge. Plain
          text at either end gets 8px more. 4px on top puts the 28px pill's centre level
          with the sidebar search beside it (56px header + 18px). Row and pill vanish
          when no page publishes meta. */}
      <div className="bg-background px-5 pb-2 pt-1 has-[>:empty]:hidden">
        <div
          ref={setMetaEl}
          data-shell-meta
          className="inline-flex max-w-full flex-wrap items-center gap-3 rounded-full bg-sunken p-1 text-sm [&:empty]:hidden [&>:first-child:not(.rounded-full)]:ml-2 [&>:last-child:not(.rounded-full)]:mr-2"
        />
      </div>
    </div>
  );
}

// Always-visible row action (ghost icon button), right-aligned and vertically
// centered to line up with the row chevrons. Hidden when the rail is collapsed.
// Requires the enclosing SidebarMenuItem to be `relative`.
function ItemActionButton({ action }: { action: ItemAction }) {
  const { collapsed, setMobileOpen } = useSidebar();
  if (collapsed) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={(e) => { e.stopPropagation(); setMobileOpen(false); action.onClick(); }}
      aria-label={action.label}
      title={action.label}
      className="absolute right-1.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground max-md:size-9"
    >
      {action.icon ?? <Plus />}
    </Button>
  );
}

function LanguageSelect({ translation }: { translation: TranslationLike }) {
  useLangVersion();
  const { collapsed } = useSidebar();
  const current = translation.getLang();
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden transition-[max-width,opacity] duration-200",
        collapsed ? "max-w-0 opacity-0" : "max-w-[60px] opacity-100",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Language"
          title="Language"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4 max-md:size-10 max-md:[&_svg]:size-5"
        >
          <Globe />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          {LANGUAGES.map((l) => (
            <DropdownMenuItem key={l.code} onSelect={() => translation.setLang(l.code)}>
              <Check className={cn("mr-2 size-4 shrink-0", l.code === current ? "opacity-100" : "opacity-0")} />
              <span>{l.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function LogoutButton({ loginUrl }: { loginUrl: string }) {
  const { collapsed } = useSidebar();
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden transition-[max-width,opacity] duration-200",
        collapsed ? "max-w-0 opacity-0" : "max-w-[60px] opacity-100",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => logout(loginUrl)}
        aria-label="Sign out"
        title="Sign out"
        className="size-8 text-muted-foreground hover:text-foreground max-md:size-10 max-md:[&_svg]:size-5"
      >
        <LogOut />
      </Button>
    </div>
  );
}

export function AppShellLayout({ appId, appLabel, translation, loginUrl, orgsApiUrl, itemAction, topBar = true, children }: AppShellLayoutProps) {
  useLangVersion();
  useThemeFavicon();
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [baseUrls, setBaseUrls] = useState<AppBaseUrls>({});
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  // Apply and store the palette and light/dark; both are picked in User settings › Appearance.
  usePalette();
  useColorMode();
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [planLine, setPlanLine] = useState<PlanLine | null>(null);
  const planFetchedAt = useRef(0);
  const [query, setQuery] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // The menu has scrolled under the brand header: shadow it, like the top bar.
  const [menuScrolled, setMenuScrolled] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  // Reactive org token for the current slug (minted on demand, cached per tab). Drives the
  // org name + token balance so they appear once the mint lands, instead of a stale sync
  // read at first render.
  const orgToken = useRenewingOrgToken(slug ?? undefined);
  const orgName = useMemo(() => {
    if (orgToken) {
      try {
        const n = decodeJwtPayload(orgToken)?.o?.n;
        if (n) return n as string;
      } catch { /* fall through to the org list */ }
    }
    return orgs.find((o) => o.slug === slug)?.name ?? null;
  }, [orgToken, orgs, slug]);
  const lang = translation.getLang();
  const portalBase = loginUrl ?? defaultLoginUrl();
  const orgsApiBase = orgsApiUrl ?? defaultLoginApiUrl();

  const label = (item: MenuItem) => item.labels?.[lang] ?? item.labels?.en ?? item.label;

  // Shed pre-cutover per-org cookies once, so the Cookie header stops growing with the
  // number of accessible orgs. Org tokens now live in the per-tab cache.
  useEffect(() => { clearLegacyOrgCookies(); }, []);

  // Remember the org and app this tab is in, so a new tab on a bare app root — or the
  // marketing site on the apex — reopens it instead of showing a pre-login screen
  // (see orgLanding.ts).
  useEffect(() => { rememberOrg(slug, appId); }, [slug, appId]);

  // Organisations the user can switch between (for the brand picker). Fetched from
  // the CORS-enabled login-api host (the login portal sends no CORS headers).
  const refreshOrgs = React.useCallback(() => {
    // The account session cookie is HttpOnly (auto-sent via credentials:include), so
    // jwtToken() is usually null in JS now — only attach Authorization if we do have a
    // token, never `Bearer null`. tokens=false: metadata only (org tokens are minted on
    // demand per slug, so the switcher never needs a token per org).
    const token = jwtToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${orgsApiBase}/v1/organization?tokens=false`, {
      credentials: "include",
      headers,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`org list ${r.status}`))))
      .then((data: unknown) => {
        const arr = Array.isArray(data)
          ? data
          : Array.isArray((data as { organizations?: unknown })?.organizations)
            ? (data as { organizations: OrgOption[] }).organizations
            : [];
        setOrgs(arr.map((o: OrgOption) => ({ id: o.id, name: o.name, slug: o.slug, color: o.color, tag: o.tag })));
      })
      .catch((e) => { console.warn("[app-shell] org list fetch failed:", e); });
  }, [orgsApiBase]);

  // Initial load + refetch when the tab regains focus (picks up newly-added orgs).
  useEffect(() => {
    refreshOrgs();
    window.addEventListener("focus", refreshOrgs);
    return () => window.removeEventListener("focus", refreshOrgs);
  }, [refreshOrgs]);

  // The plan line for the current org (shown under the org name on desktop): the plan
  // and this month's use of its tokens, from backlogin's billing dashboard. Same
  // CORS-enabled login-api host as the org list; billing expects a `Bearer` header
  // (not Authorization) carrying the org-scoped JWT. Refetched after a chat
  // (trf:new-chat), since that is what uses tokens, and on focus at most once a minute.
  const refreshPlanLine = React.useCallback((force = true) => {
    if (!orgToken) { setPlanLine(null); return; }
    if (!force && Date.now() - planFetchedAt.current < PLAN_REFRESH_MIN_MS) return;
    planFetchedAt.current = Date.now();
    fetch(`${orgsApiBase}/v1/billing/dashboard`, {
      credentials: "include",
      headers: { Bearer: orgToken },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`dashboard ${r.status}`))))
      .then((d: { package?: string; plan?: string; plan_tokens?: number; used_this_month?: number }) => {
        const plan = d?.plan || d?.package;
        if (!plan) { setPlanLine(null); return; }
        // An older backlogin sends neither number: the plan alone, no percentage.
        const usedPct = typeof d.used_this_month === "number" && typeof d.plan_tokens === "number" && d.plan_tokens > 0
          ? Math.round((d.used_this_month / d.plan_tokens) * 100)
          : null;
        setPlanLine({ plan, usedPct });
      })
      .catch(() => { /* leave previous value; brand falls back to appLabel */ });
  }, [orgsApiBase, orgToken]);

  useEffect(() => {
    refreshPlanLine();
    const onFocus = () => refreshPlanLine(false);
    const onChat = () => refreshPlanLine();
    window.addEventListener("focus", onFocus);
    window.addEventListener("trf:new-chat", onChat);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("trf:new-chat", onChat);
    };
  }, [refreshPlanLine]);

  useEffect(() => {
    // When a slug is present the discovery menu is org-scoped, so wait for the org token to
    // mint before calling it. Firing early (orgToken still null) makes the discovery client
    // fall back to the account `jwt_token` cookie and send it to the org-scoped endpoint,
    // which rejects it with 401 "invalid token". The no-slug case (e.g. /app/new-organization)
    // has no org token and legitimately falls back to the account credential.
    if (slug && !orgToken) return;
    let cancelled = false;
    // Hand the (minted, reactive) org token to the discovery client instead of pointing it
    // at a per-org cookie. Re-runs when the token lands so the menu authenticates correctly.
    void fetchDiscoveryMenu({
      authToken: orgToken ?? undefined,
      credentials: "include",
    }).then((r) => {
      if (cancelled) return;
      setItems(r.items);
      setBaseUrls(r.baseUrls);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug, orgToken]);

  // Resolve an item to a URL + whether it belongs to THIS app (route locally vs leave).
  const resolve = (item: MenuItem): { href?: string; internal: boolean } => {
    const url = item.externalUrl
      ? injectSlug(item.externalUrl, slug)
      : item.path && item.appId && baseUrls[item.appId]
        ? joinUrl(baseUrls[item.appId]!, injectSlug(item.path, slug)!)
        : injectSlug(item.path, slug);
    if (!url) return { internal: false };
    try {
      const parsed = new URL(url, window.location.origin);
      const sameApp =
        parsed.origin === window.location.origin || parsed.hostname.split(".")[0] === appId;
      return { href: sameApp ? parsed.pathname : url, internal: sameApp };
    } catch {
      return { href: url, internal: url.startsWith("/") };
    }
  };

  const isActive = (item: MenuItem): boolean => {
    const { href, internal } = resolve(item);
    if (!internal || !href) return false;
    return location.pathname === href || location.pathname.startsWith(href + "/");
  };
  const hasActiveChild = (item: MenuItem): boolean =>
    !!item.children?.some((c) => isActive(c) || hasActiveChild(c));

  // Ids of every group on the active path (any depth) — so the full branch opens.
  const activeGroupIds = (nodes: MenuItem[]): string[] => {
    const ids: string[] = [];
    for (const n of nodes) {
      if (n.children?.length && hasActiveChild(n)) {
        ids.push(n.id, ...activeGroupIds(n.children));
      }
    }
    return ids;
  };

  // Deepest active leaf (the current "section", e.g. "Chat") — label for the
  // mobile breadcrumb, full item for the desktop bar (which links via go()).
  const activeSectionLeaf = (nodes: MenuItem[]): MenuItem | null => {
    for (const n of nodes) {
      if (n.children?.length) {
        const sub = activeSectionLeaf(n.children);
        if (sub) return sub;
      } else if (isActive(n)) {
        return n;
      }
    }
    return null;
  };

  // The whole chain down to that leaf ("Sales" › "Invoices"), for the tab title.
  // Same walk as activeSectionLeaf, which returns only the leaf because that is
  // all the bars need.
  const activeSectionPath = (nodes: MenuItem[]): MenuItem[] | null => {
    for (const n of nodes) {
      if (n.children?.length) {
        const sub = activeSectionPath(n.children);
        if (!sub) continue;
        // A group holding a single leaf renders as one row carrying the group's
        // label (see renderNode), so naming both would make the title disagree
        // with the sidebar it describes.
        const collapsed = n.children.length === 1 && !n.children[0].children?.length;
        return collapsed ? [n] : [n, ...sub];
      }
      if (isActive(n)) return [n];
    }
    return null;
  };

  const sectionLeaf = activeSectionLeaf(items);
  // Until the discovery menu lands — and on any route it does not cover — fall
  // back to the app's own label, so the title never degrades to a bare product
  // name on a cold load.
  const sectionPath = activeSectionPath(items);
  // Outermost group + leaf, dropping any middle levels. Settings is three deep
  // ("Settings › Sales & Invoicing › Invoice settings"), which pushes the page's
  // own name past where a tab or a bookmark truncates — the exact thing the
  // title exists to fix. Two levels is also the shape the rest of the menu has.
  const titlePath = sectionPath?.length
    ? (sectionPath.length > 2 ? [sectionPath[0], sectionPath[sectionPath.length - 1]] : sectionPath).map(label)
    : [appLabel];

  // Auto-open the active route's group(s) once the menu has loaded / the route changes.
  useEffect(() => {
    const active = activeGroupIds(items);
    if (active.length) setOpenGroups((prev) => Array.from(new Set([...prev, ...active])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, baseUrls, location.pathname]);

  const go = (item: MenuItem) => {
    if (item.disabled) return;
    const { href, internal } = resolve(item);
    if (!href) return;
    if (internal) navigate(href);
    else window.location.href = href;
  };

  // Navigate to a leaf from search, then clear the query / close the palette so the
  // tree (with the now-active row) is shown next time the menu opens.
  const goFromSearch = (item: MenuItem) => {
    setQuery("");
    setPaletteOpen(false);
    go(item);
  };

  // Flatten the discovery menu to navigable leaves once per menu/locale change.
  const searchLeaves = useMemo<SearchLeaf[]>(() => {
    const out: SearchLeaf[] = [];
    const walk = (nodes: MenuItem[], trail: string[]) => {
      for (const n of nodes) {
        const lbl = label(n);
        if (n.children?.length) {
          walk(n.children, [...trail, lbl]);
          continue;
        }
        const labels = n.labels ? Object.values(n.labels) : [];
        const keywords = (n as Searchable).keywords ?? [];
        const hay = normalize([n.label, lbl, ...labels, ...keywords].join(" "));
        out.push({ item: n, ...resolve(n), trail, hay });
      }
    };
    walk(items, []);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, baseUrls, slug, lang]);

  const results = useMemo(
    () => searchLeaves.filter((l) => matchesQuery(l.hay, query)),
    [searchLeaves, query],
  );

  // First result is auto-selected; reset to it whenever the query (hence results) changes.
  useEffect(() => { setActiveIndex(0); }, [query]);
  // Keep the highlighted result scrolled into view as the user arrows through.
  useEffect(() => {
    resultsRef.current
      ?.querySelector<HTMLElement>(`[data-result-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  // Arrow/Enter navigation for the inline result list (wraps around). Escape clears.
  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setQuery(""); return; }
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const leaf = results[activeIndex] ?? results[0];
      if (leaf) goFromSearch(leaf.item);
    }
  };

  // ⌘K / Ctrl-K toggles the command palette anywhere (also works on the collapsed rail).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Built-in "new chat" + on the AI chat row, shown in EVERY app's menu. Detects the
  // AI chat leaf generically: app id "ai" (or an ai.* host for cross-app links) on the
  // /chat route (or the AI app index). Clicking opens a fresh AI chat — internally when
  // already in the AI app (+ a trf:new-chat reset event), else a full cross-app nav.
  const aiChatAction = (item: MenuItem, ctx: { href?: string; internal: boolean }): ItemAction | null => {
    if (!ctx.href) return null;
    let host = "", path = ctx.href;
    try { const u = new URL(ctx.href, window.location.origin); host = u.hostname; path = u.pathname; } catch { /* relative */ }
    const isAi = item.appId === "ai" || host.split(".")[0] === "ai" || (ctx.internal && appId === "ai");
    const isChat = path.endsWith("/chat") || (!!slug && path === `/app/${slug}`);
    if (!isAi || !isChat) return null;
    return {
      label: "New chat",
      onClick: () => {
        if (ctx.internal) navigate(ctx.href!);
        else window.location.href = ctx.href!;
        window.dispatchEvent(new Event("trf:new-chat"));
      },
    };
  };

  // Recursive nav node: a group (with children) recurses into SidebarMenuSub; a leaf
  // navigates. Only top-level rows carry a domain icon (matches the existing look).
  const renderNode = (item: MenuItem, top: boolean): React.ReactNode => {
    const Icon = top ? (ICONS[item.label.toLowerCase()] ?? Circle) : undefined;
    // A group holding a single leaf adds a needless level (e.g. "Products › Product
    // Settings"): collapse it to one row — keep the category label/icon, navigate to
    // the lone child.
    const collapsed =
      item.children?.length === 1 && !item.children[0].children?.length
        ? { ...item.children[0], label: item.label, labels: item.labels }
        : null;
    if (!collapsed && item.children?.length) {
      return (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton groupId={item.id} icon={Icon ? <Icon /> : undefined} tooltip={item.label}>
            {label(item)}
          </SidebarMenuButton>
          <SidebarMenuSub groupId={item.id}>
            {item.children.map((c) => renderNode(c, false))}
          </SidebarMenuSub>
        </SidebarMenuItem>
      );
    }
    const node = collapsed ?? item;
    const ctx = resolve(node);
    const action = itemAction?.(node, ctx) ?? aiChatAction(node, ctx);
    return (
      <SidebarMenuItem key={node.id} className={action ? "group/item relative" : undefined}>
        <SidebarMenuButton
          icon={Icon ? <Icon /> : undefined}
          tooltip={node.label}
          isActive={isActive(node)}
          onClick={() => go(node)}
        >
          {label(node)}
        </SidebarMenuButton>
        {action && <ItemActionButton action={action} />}
      </SidebarMenuItem>
    );
  };

  const orgSwitcherTexts = ORG_SWITCHER_TEXTS[lang] ?? ORG_SWITCHER_TEXTS.en;
  const orgProps: OrgPickerProps = {
    orgs,
    currentSlug: slug,
    onSelect: (s) => navigate(`/app/${s}`),
    onOpen: refreshOrgs,
    searchPlaceholder: orgSwitcherTexts.search,
    emptyText: orgSwitcherTexts.empty,
  };

  const sidebar = (
    <Sidebar>
      {/* Mobile drawer header: the same breadcrumb bar as the closed top bar. */}
      <MobileBar orgName={orgName} appLabel={appLabel} section={sectionLeaf ? label(sectionLeaf) : null} {...orgProps} />
      {/* Desktop brand (org picker). */}
      {/* relative z-10 so its shadow paints over the menu rows scrolling below it. */}
      <SidebarHeader
        className={cn(
          "relative z-10 hidden border-b-0 transition-shadow duration-200 md:flex",
          menuScrolled && "shadow-md",
        )}
      >
        <SidebarBrand orgName={orgName} appLabel={appLabel} planLine={planLine} lang={lang} {...orgProps} />
      </SidebarHeader>
      {/* No top padding: the search sits right under the brand header. */}
      <SidebarContent className="pt-0" onScroll={(e) => setMenuScrolled(e.currentTarget.scrollTop > 0)}>
        <MenuSearchBox query={query} setQuery={setQuery} onOpenPalette={() => setPaletteOpen(true)} onKeyDown={onSearchKeyDown} />
        {query.trim() ? (
          <div ref={resultsRef}>
            <SidebarMenu>
              {results.length === 0 ? (
                <Text className="px-3 py-2 text-sm text-muted-foreground">No matches</Text>
              ) : (
                results.map((leaf, idx) => (
                  <SidebarMenuItem key={leaf.item.id}>
                    <SidebarMenuButton
                      data-result-index={idx}
                      tooltip={label(leaf.item)}
                      isActive={isActive(leaf.item)}
                      onMouseMove={() => setActiveIndex(idx)}
                      onClick={() => goFromSearch(leaf.item)}
                      className={idx === activeIndex ? "bg-accent text-accent-foreground" : undefined}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">
                          <Highlight text={label(leaf.item)} query={query} />
                        </span>
                        {leaf.trail.length > 0 && (
                          <span className="truncate text-xs text-muted-foreground">
                            {leaf.trail.join(" › ")}
                          </span>
                        )}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </div>
        ) : (
          <SidebarMenu>
            {items.map((item) => renderNode(item, true))}
          </SidebarMenu>
        )}
      </SidebarContent>
      <SidebarFooter className="max-md:min-h-14 max-md:justify-around max-md:px-3">
        <LanguageSelect translation={translation} />
        <LogoutButton loginUrl={portalBase} />
        <SidebarTrigger />
      </SidebarFooter>
    </Sidebar>
  );

  // Each page owns its own content container (chat fills height; others center).
  // The shell owns the top chrome inside the inset: the mobile bar (md:hidden)
  // and, unless topBar is disabled, the desktop breadcrumb bar (hidden md:flex).
  return (
    <ShellCrumbsProvider>
      <DocumentTitle orgName={orgName} path={titlePath} />
      <AppShell sidebar={sidebar} openGroups={openGroups} onOpenGroupsChange={setOpenGroups}>
        <MobileBar orgName={orgName} appLabel={appLabel} section={sectionLeaf ? label(sectionLeaf) : null} scrollHide {...orgProps} />
        {topBar && (
          <DesktopBarUnlessHidden
            appLabel={appLabel}
            section={sectionLeaf ? label(sectionLeaf) : null}
            onSection={() => { if (sectionLeaf) go(sectionLeaf); }}
          />
        )}
        {children}
      </AppShell>

      {/* ⌘K command palette — shares the same flatten/match core as the inline box. */}
      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Search menu</DialogTitle>
          <Command filter={(_v, search, keywords) => (keywords && matchesQuery(keywords[0] ?? "", search) ? 1 : 0)}>
            <CommandInput placeholder="Search menu…" />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              {searchLeaves.map((leaf) => (
                <CommandItem key={leaf.item.id} value={leaf.item.id} keywords={[leaf.hay]} onSelect={() => goFromSearch(leaf.item)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{label(leaf.item)}</span>
                    {leaf.trail.length > 0 && (
                      <span className="truncate text-xs text-muted-foreground">{leaf.trail.join(" › ")}</span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </ShellCrumbsProvider>
  );
}
