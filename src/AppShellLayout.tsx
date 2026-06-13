import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Sparkles, BadgeDollarSign, Receipt, Wallet, Package, ScrollText, PieChart, Handshake,
  Files, Boxes, Table2, Settings, ClipboardCheck, Network, Moon, Sun, Circle,
  Plus, LogOut, ChevronsUpDown, Check, Globe,
} from "lucide-react";
import {
  AppShell, Sidebar, SidebarHeader, SidebarContent, SidebarFooter, SidebarMenu,
  SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarTrigger, useSidebar,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
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
  /** Login portal base (e.g. https://login.trf.is) for the org list + logout redirect. Defaults from the current hostname. */
  loginUrl?: string;
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

function orgNameFromCookie(slug?: string): string | null {
  if (!slug) return null;
  const m = document.cookie.match(new RegExp(`trf_jwt_${slug}=([^;]+)`));
  if (!m) return null;
  try {
    const payload = JSON.parse(atob(m[1].split(".")[1]));
    return payload?.organization?.name ?? null;
  } catch {
    return null;
  }
}

function defaultLoginUrl(): string {
  if (typeof window === "undefined") return "https://login.trf.is";
  const parts = window.location.hostname.split(".");
  const apex = parts.length >= 2 ? parts.slice(-2).join(".") : "trf.is";
  return `https://login.${apex}`;
}

/** Re-render when the language changes (TranslationClient.setLang dispatches this). */
function useLangVersion(): void {
  const [, setV] = useState(0);
  useEffect(() => {
    const h = () => setV((v) => v + 1);
    window.addEventListener("trf:lang-changed", h);
    return () => window.removeEventListener("trf:lang-changed", h);
  }, []);
}

function SidebarBrandInner({ orgName, appLabel, showChevron }: { orgName: string | null; appLabel: string; showChevron: boolean }) {
  const { collapsed } = useSidebar();
  return (
    <div className="flex w-full items-center gap-2 overflow-hidden px-4 py-3.5">
      <Logo size={26} className="shrink-0" />
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1 overflow-hidden transition-[max-width,opacity] duration-200",
          collapsed ? "max-w-0 opacity-0" : "max-w-[12rem] opacity-100",
        )}
      >
        <div className="min-w-0 flex-1 text-left">
          <Text as="span" size="sm" weight="semibold" className="block truncate leading-tight">{orgName ?? "TRF"}</Text>
          <Text as="span" size="xs" tone="muted" className="block truncate">{appLabel}</Text>
        </div>
        {showChevron && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
      </div>
    </div>
  );
}

// Brand header. With >1 organisation it becomes a picker that switches org by
// navigating to `/app/<slug>`; otherwise it's the plain (non-interactive) brand.
function SidebarBrand({
  orgName, appLabel, orgs, currentSlug, onSelect,
}: {
  orgName: string | null;
  appLabel: string;
  orgs: OrgOption[];
  currentSlug?: string;
  onSelect: (slug: string) => void;
}) {
  if (orgs.length <= 1) return <SidebarBrandInner orgName={orgName} appLabel={appLabel} showChevron={false} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full hover:bg-muted transition-colors">
        <SidebarBrandInner orgName={orgName} appLabel={appLabel} showChevron />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {orgs.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => onSelect(o.slug)}>
            <Check className={cn("mr-2 size-4 shrink-0", o.slug === currentSlug ? "opacity-100" : "opacity-0")} />
            <span className="truncate">{o.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4"
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
        className="size-8 text-muted-foreground hover:text-foreground"
      >
        <LogOut />
      </Button>
    </div>
  );
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
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
        onClick={onToggle}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        title={dark ? "Switch to light mode" : "Switch to dark mode"}
        className="size-8 text-muted-foreground hover:text-foreground"
      >
        {dark ? <Sun /> : <Moon />}
      </Button>
    </div>
  );
}

export function AppShellLayout({ appId, appLabel, translation, loginUrl, itemAction, children }: AppShellLayoutProps) {
  useLangVersion();
  const navigate = useNavigate();
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();

  const [items, setItems] = useState<MenuItem[]>([]);
  const [baseUrls, setBaseUrls] = useState<AppBaseUrls>({});
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [dark, setDark] = useState<boolean>(() => localStorage.getItem("trf-theme") === "dark");
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const orgName = useMemo(() => orgNameFromCookie(slug), [slug]);
  const lang = translation.getLang();
  const portalBase = loginUrl ?? defaultLoginUrl();

  const label = (item: MenuItem) => item.labels?.[lang] ?? item.labels?.en ?? item.label;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("trf-theme", dark ? "dark" : "light");
  }, [dark]);

  // Organisations the user can switch between (for the brand picker).
  useEffect(() => {
    const token = jwtToken();
    if (!token) return;
    let cancelled = false;
    fetch(`${portalBase}/v1/organization`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (cancelled) return;
        const list = (Array.isArray(data) ? data : []).map((o: OrgOption) => ({ id: o.id, name: o.name, slug: o.slug }));
        setOrgs(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [portalBase]);

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

  // Auto-open the active route's group once the menu has loaded / the route changes.
  useEffect(() => {
    const active = items.filter((i) => i.children?.length && hasActiveChild(i)).map((i) => i.id);
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

  // A leaf/child nav row, optionally with a hover action.
  const renderRow = (item: MenuItem, opts: { icon?: React.ReactNode } = {}) => {
    const action = itemAction?.(item, resolve(item)) ?? null;
    return (
      <SidebarMenuItem key={item.id} className={action ? "group/item relative" : undefined}>
        <SidebarMenuButton
          icon={opts.icon}
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

  const sidebar = (
    <Sidebar>
      <SidebarHeader>
        <SidebarBrand
          orgName={orgName}
          appLabel={appLabel}
          orgs={orgs}
          currentSlug={slug}
          onSelect={(s) => navigate(`/app/${s}`)}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = ICONS[item.label.toLowerCase()] ?? Circle;
            if (item.children?.length) {
              return (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton groupId={item.id} icon={<Icon />} tooltip={item.label}>
                    {label(item)}
                  </SidebarMenuButton>
                  <SidebarMenuSub groupId={item.id}>
                    {item.children.map((child) => renderRow(child))}
                  </SidebarMenuSub>
                </SidebarMenuItem>
              );
            }
            return renderRow(item, { icon: <Icon /> });
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <LanguageSelect translation={translation} />
        <ThemeToggle dark={dark} onToggle={() => setDark((d) => !d)} />
        <LogoutButton loginUrl={portalBase} />
        <SidebarTrigger />
      </SidebarFooter>
    </Sidebar>
  );

  // Each page owns its own content container (chat fills height; others center).
  return (
    <AppShell sidebar={sidebar} openGroups={openGroups} onOpenGroupsChange={setOpenGroups}>
      {children}
    </AppShell>
  );
}
