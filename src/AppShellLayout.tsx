import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Sparkles, BadgeDollarSign, Receipt, Wallet, Package, ScrollText, PieChart, Handshake,
  Files, Boxes, Table2, Settings, ClipboardCheck, Network, Moon, Sun, Monitor, Circle,
  Plus, LogOut, ChevronRight, Check, Globe, Menu, X,
} from "lucide-react";
import {
  AppShell, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarTrigger, useSidebar,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  Button, Logo, Text, cn,
} from "@trf/ui2";
import { fetchDiscoveryMenu, logout } from "@trf/ui";
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
  children: React.ReactNode;
}

interface OrgOption { id: string; name: string; slug: string }

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ee", label: "Eesti" },
  { code: "lv", label: "Latviešu" },
  { code: "lt", label: "Lietuvių" },
];

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "oto ai": Sparkles, ai: Sparkles, sales: BadgeDollarSign, purchase: Receipt, payments: Wallet,
  products: Package, ledger: ScrollText, reports: PieChart, crm: Handshake,
  contracts: Files, items: Boxes, tables: Table2, settings: Settings,
  audit: ClipboardCheck, organizations: Network,
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
function decodeJwtPayload(token: string): { organization?: { name?: string } } {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function orgNameFromCookie(slug?: string): string | null {
  if (!slug) return null;
  const m = document.cookie.match(new RegExp(`trf_jwt_${slug}=([^;]+)`));
  if (!m) return null;
  try {
    return decodeJwtPayload(m[1])?.organization?.name ?? null;
  } catch {
    return null;
  }
}

function apexFor(sub: string): string {
  if (typeof window === "undefined") return `https://${sub}.trf.is`;
  const parts = window.location.hostname.split(".");
  const apex = parts.length >= 2 ? parts.slice(-2).join(".") : "trf.is";
  return `https://${sub}.${apex}`;
}
const defaultLoginUrl = () => apexFor("login");      // user-facing portal
const defaultLoginApiUrl = () => apexFor("login-api"); // CORS-enabled API

// Theme is stored as a cookie on the apex domain (e.g. `.trf.is`) so the choice is
// shared across every *.trf.is service — navigating AI → Purchase keeps the theme.
type ThemeChoice = "light" | "dark" | "system";
function readThemeChoice(): ThemeChoice {
  const m = document.cookie.match(/(?:^|; )trf-theme=([^;]*)/);
  const v = m ? decodeURIComponent(m[1]) : localStorage.getItem("trf-theme");
  return v === "light" || v === "dark" || v === "system" ? v : "light";
}
function writeThemeChoice(v: ThemeChoice): void {
  const parts = window.location.hostname.split(".");
  const domain = parts.length >= 2 ? `; domain=.${parts.slice(-2).join(".")}` : "";
  document.cookie = `trf-theme=${v}; path=/; max-age=31536000; samesite=lax${domain}`;
}
const systemPrefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolveDark = (c: ThemeChoice) => (c === "system" ? systemPrefersDark() : c === "dark");

/** Re-render when the language changes (TranslationClient.setLang dispatches this). */
function useLangVersion(): void {
  const [, setV] = useState(0);
  useEffect(() => {
    const h = () => setV((v) => v + 1);
    window.addEventListener("trf:lang-changed", h);
    return () => window.removeEventListener("trf:lang-changed", h);
  }, []);
}

function SidebarBrandInner({ orgName, appLabel }: { orgName: string | null; appLabel: string }) {
  const { collapsed } = useSidebar();
  return (
    <div className="flex w-full items-center gap-2 overflow-hidden px-4 py-3.5">
      <Logo size={26} className="shrink-0" />
      <div
        className={cn(
          "min-w-0 flex-1 overflow-hidden text-left transition-[max-width,opacity] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[12rem] opacity-100",
        )}
      >
        <Text as="span" size="sm" weight="semibold" className="block truncate leading-tight">{orgName ?? "TRF"}</Text>
        <Text as="span" size="xs" tone="muted" className="block truncate">{appLabel}</Text>
      </div>
    </div>
  );
}

interface OrgPickerProps {
  orgs: OrgOption[];
  currentSlug?: string;
  onSelect: (slug: string) => void;
  orgSettingsUrl: string;
  onOpen: () => void;
}

// Shared dropdown body: switch orgs (when >1) + an "Organisation settings" link.
function OrgMenuItems({ orgs, currentSlug, onSelect, orgSettingsUrl }: Omit<OrgPickerProps, "onOpen">) {
  const { setMobileOpen } = useSidebar();
  return (
    <DropdownMenuContent align="start" className="w-56">
      {orgs.length > 1 && (
        <>
          {orgs.map((o) => (
            <DropdownMenuItem key={o.id} onSelect={() => { setMobileOpen(false); onSelect(o.slug); }}>
              <Check className={cn("mr-2 size-4 shrink-0", o.slug === currentSlug ? "opacity-100" : "opacity-0")} />
              <span className="truncate">{o.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onSelect={() => { setMobileOpen(false); window.location.href = orgSettingsUrl; }}>
        <Settings className="mr-2 size-4 shrink-0" />
        <span>Organisation settings</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

// Desktop brand header — the whole block is the org-picker trigger (no chevron;
// tapping the org name opens the picker).
function SidebarBrand({ orgName, appLabel, ...org }: { orgName: string | null; appLabel: string } & OrgPickerProps) {
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) org.onOpen(); }}>
      <DropdownMenuTrigger className="w-full hover:bg-muted transition-colors">
        <SidebarBrandInner orgName={orgName} appLabel={appLabel} />
      </DropdownMenuTrigger>
      <OrgMenuItems {...org} />
    </DropdownMenu>
  );
}

// Hide the top bar when scrolling down its scroll container, show it on scroll up.
// Returns a ref to attach to the bar and whether it should be hidden.
function useHideOnScroll(enabled?: boolean): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let sc = ref.current?.parentElement ?? null;
    while (sc) {
      const oy = getComputedStyle(sc).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      sc = sc.parentElement;
    }
    if (!sc) return;
    const target = sc;
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
      <Logo size={22} className="shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        <DropdownMenu onOpenChange={(open) => { if (open) org.onOpen(); }}>
          <DropdownMenuTrigger className="min-w-0 truncate font-medium outline-none hover:opacity-80">
            {orgName ?? "TRF"}
          </DropdownMenuTrigger>
          <OrgMenuItems {...org} />
        </DropdownMenu>
        <Sep />
        <span className="shrink-0 text-muted-foreground">{appLabel}</span>
        {section && (<><Sep /><span className="min-w-0 truncate font-medium">{section}</span></>)}
      </div>
      <MobileToggle />
    </div>
  );
}

// Hover-reveal row action (hidden when the rail is collapsed). Requires the
// enclosing SidebarMenuItem to have `group/item relative`.
function ItemActionButton({ action }: { action: ItemAction }) {
  const { collapsed } = useSidebar();
  if (collapsed) return null;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); action.onClick(); }}
      aria-label={action.label}
      title={action.label}
      className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100 [&_svg]:size-4"
    >
      {action.icon ?? <Plus />}
    </button>
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
        <DropdownMenuContent align="start" className="w-40">
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

const THEME_OPTIONS: { value: ThemeChoice; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

function ThemeSelect({ choice, onChange }: { choice: ThemeChoice; onChange: (c: ThemeChoice) => void }) {
  const { collapsed } = useSidebar();
  const TriggerIcon = choice === "dark" ? Moon : choice === "system" ? Monitor : Sun;
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden transition-[max-width,opacity] duration-200",
        collapsed ? "max-w-0 opacity-0" : "max-w-[60px] opacity-100",
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Theme"
          title="Theme"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4 max-md:size-10 max-md:[&_svg]:size-5"
        >
          <TriggerIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuItem key={value} onSelect={() => onChange(value)}>
              <Check className={cn("mr-2 size-4 shrink-0", value === choice ? "opacity-100" : "opacity-0")} />
              <Icon className="mr-2 size-4 shrink-0" />
              <span>{label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AppShellLayout({ appId, appLabel, translation, loginUrl, orgsApiUrl, itemAction, children }: AppShellLayoutProps) {
  useLangVersion();
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [baseUrls, setBaseUrls] = useState<AppBaseUrls>({});
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(readThemeChoice);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const orgName = useMemo(() => orgNameFromCookie(slug), [slug]);
  const lang = translation.getLang();
  const portalBase = loginUrl ?? defaultLoginUrl();
  const orgsApiBase = orgsApiUrl ?? defaultLoginApiUrl();
  const orgSettingsUrl = slug
    ? `${portalBase}/app/${slug}/manage-organization/list`
    : `${portalBase}/app/manage-organization`;

  const label = (item: MenuItem) => item.labels?.[lang] ?? item.labels?.en ?? item.label;

  // Apply theme; persist the choice to the apex cookie; follow the OS live in "system".
  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle("dark", resolveDark(themeChoice));
    apply();
    writeThemeChoice(themeChoice);
    localStorage.setItem("trf-theme", themeChoice);
    if (themeChoice === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [themeChoice]);

  // Organisations the user can switch between (for the brand picker). Fetched from
  // the CORS-enabled login-api host (the login portal sends no CORS headers).
  const refreshOrgs = React.useCallback(() => {
    const token = jwtToken();
    if (!token) return;
    fetch(`${orgsApiBase}/v1/organization`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`org list ${r.status}`))))
      .then((data: unknown) => {
        const arr = Array.isArray(data)
          ? data
          : Array.isArray((data as { organizations?: unknown })?.organizations)
            ? (data as { organizations: OrgOption[] }).organizations
            : [];
        setOrgs(arr.map((o: OrgOption) => ({ id: o.id, name: o.name, slug: o.slug })));
      })
      .catch((e) => { console.warn("[app-shell] org list fetch failed:", e); });
  }, [orgsApiBase]);

  // Initial load + refetch when the tab regains focus (picks up newly-added orgs).
  useEffect(() => {
    refreshOrgs();
    window.addEventListener("focus", refreshOrgs);
    return () => window.removeEventListener("focus", refreshOrgs);
  }, [refreshOrgs]);

  useEffect(() => {
    let cancelled = false;
    fetchDiscoveryMenu({
      authCookieName: slug ? `trf_jwt_${slug}` : undefined,
      credentials: "include",
    })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setBaseUrls(r.baseUrls);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

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

  // Label of the deepest active leaf (the current "section", e.g. "Chat") — for the breadcrumb.
  const activeSectionLabel = (nodes: MenuItem[]): string | null => {
    for (const n of nodes) {
      if (n.children?.length) {
        const sub = activeSectionLabel(n.children);
        if (sub) return sub;
      } else if (isActive(n)) {
        return label(n);
      }
    }
    return null;
  };

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

  // Recursive nav node: a group (with children) recurses into SidebarMenuSub; a leaf
  // navigates. Only top-level rows carry a domain icon (matches the existing look).
  const renderNode = (item: MenuItem, top: boolean): React.ReactNode => {
    const Icon = top ? (ICONS[item.label.toLowerCase()] ?? Circle) : undefined;
    if (item.children?.length) {
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
    const action = itemAction?.(item, resolve(item)) ?? null;
    return (
      <SidebarMenuItem key={item.id} className={action ? "group/item relative" : undefined}>
        <SidebarMenuButton
          icon={Icon ? <Icon /> : undefined}
          tooltip={item.label}
          isActive={isActive(item)}
          onClick={() => go(item)}
        >
          {label(item)}
        </SidebarMenuButton>
        {action && <ItemActionButton action={action} />}
      </SidebarMenuItem>
    );
  };

  const orgProps: OrgPickerProps = {
    orgs,
    currentSlug: slug,
    onSelect: (s) => navigate(`/app/${s}`),
    orgSettingsUrl,
    onOpen: refreshOrgs,
  };

  const sidebar = (
    <Sidebar>
      {/* Mobile drawer header: the same breadcrumb bar as the closed top bar. */}
      <MobileBar orgName={orgName} appLabel={appLabel} section={activeSectionLabel(items)} {...orgProps} />
      {/* Desktop brand (org picker). */}
      <SidebarHeader className="hidden md:flex">
        <SidebarBrand orgName={orgName} appLabel={appLabel} {...orgProps} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {items.map((item) => renderNode(item, true))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="max-md:min-h-14 max-md:justify-around max-md:px-3">
        <LanguageSelect translation={translation} />
        <ThemeSelect choice={themeChoice} onChange={setThemeChoice} />
        <LogoutButton loginUrl={portalBase} />
        <SidebarTrigger />
      </SidebarFooter>
    </Sidebar>
  );

  // Each page owns its own content container (chat fills height; others center).
  // The mobile top bar (md:hidden) sits above the routed content inside the inset.
  return (
    <AppShell sidebar={sidebar} openGroups={openGroups} onOpenGroupsChange={setOpenGroups}>
      <MobileBar orgName={orgName} appLabel={appLabel} section={activeSectionLabel(items)} scrollHide {...orgProps} />
      {children}
    </AppShell>
  );
}
