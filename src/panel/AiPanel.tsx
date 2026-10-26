import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button, cn, useSidebar } from "@trf/ui2";
import type { ColorMode } from "../appearance";
import {
  aiPanelPath,
  envelope,
  identityFromToken,
  newConnectionId,
  parsePanelMessage,
  type AiActionResult,
  type AiHostMessage,
  type AiIdentity,
  type AiNavigateTarget,
  type AiPageContext,
} from "./protocol";
import { pageEntityFromPath, pagePath } from "./pageEntity";
import { composePageContext } from "./pageCompose";
import { createActionStore, createPageStore, findAction, type AiActionStore, type AiPageStore } from "./pageContext";
import { actionTypesFor, normaliseActionRequest, normaliseActionResult, normaliseNavigate } from "./hostActions";
import {
  EXPAND_OVERSHOOT,
  PAGE_MIN_WIDTH,
  PANEL_MIN_WIDTH,
  SNAP_CLOSE_WIDTH,
  clampPanelWidth,
  maxPanelWidth,
  readPanelState,
  writePanelState,
} from "./panelState";

/*
 * The AI panel: frontai's panel route in an iframe docked at the right of the shell,
 * pushing the page. Phase 0 of the plan (documentation/AI-SIDEPANEL-PLAN.md, section 6,
 * track 2): the button and shortcut, the handshake, focus on open, resize with a drag
 * shield, live theme and language, open state and width in an apex cookie, big chat.
 * The conversation itself, and which one resumes, is the panel's own business (frontai).
 */

export interface AiPanelOptions {
  slug: string | undefined;
  /** The host's own org token: its account and org are what the panel must come back with. */
  orgToken: string | null;
  /** The AI app's base URL (discovery `base_urls.ai`, or the dev override). */
  panelBase: string | null;
  lang: string;
  colorMode: ColorMode;
  palette: string;
  /** False where the panel does not show: the AI app itself, the login app. */
  enabled: boolean;
  /** The host app's id and current route, for the `context` message (AI-PANEL-ACTIONS.md). */
  appId?: string;
  pathname?: string;
  /**
   * Carries out the panel's `navigate` request, already checked to be a route of ours: in this
   * app through the router, in another app through its base URL from discovery. Without it
   * the request is ignored.
   */
  onNavigate?: (target: AiNavigateTarget) => void;
}

export type AiPanelStatus =
  /** Not mounted yet, or no panel URL known. */
  | "idle"
  /** The iframe is loading or signing in. */
  | "loading"
  /** Handshake complete; the panel is signed in as this account for this org. */
  | "ready"
  /** The panel came back as another account or org; nothing is sent to it. */
  | "mismatch";

export interface AiPanel {
  enabled: boolean;
  open: boolean;
  expanded: boolean;
  width: number;
  unread: boolean;
  status: AiPanelStatus;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  /** Internal wiring for the two components. */
  _: {
    src: string | null;
    panelOrigin: string | null;
    mounted: boolean;
    animate: boolean;
    dragging: boolean;
    canDock: boolean;
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    startDrag: (e: React.PointerEvent) => void;
    /** Whether the panel collapsed the left menu (PanelMenuFit). */
    menuCollapsed: boolean;
    setMenuCollapsed: (v: boolean) => void;
    /** What the page declares about itself (useAiPageContext); the shell provides it around the page. */
    pageStore: AiPageStore;
    /** What the page can do for the panel (useAiPageActions); provided the same way. */
    actionStore: AiActionStore;
  };
}

/** How long a burst of page changes (a click through a selection) waits before the panel hears it. */
const CONTEXT_DEBOUNCE_MS = 200;

function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Dev override for the AI app's URL, so a local host can embed a local panel. */
function devPanelBase(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_AI_PANEL_URL?.trim() || null;
}

export function useAiPanel(opts: AiPanelOptions): AiPanel {
  const { slug, orgToken, lang, colorMode, palette } = opts;
  const enabled = opts.enabled && typeof window !== "undefined";
  const panelBase = useMemo(() => devPanelBase() ?? opts.panelBase, [opts.panelBase]);
  const panelOrigin = useMemo(() => originOf(panelBase), [panelBase]);
  const src = useMemo(
    () => (panelBase && slug ? panelBase.replace(/\/+$/, "") + aiPanelPath(slug) : null),
    [panelBase, slug],
  );

  const initial = useMemo(readPanelState, []);
  const [open, setOpenState] = useState(enabled && initial.open);
  const [width, setWidth] = useState(initial.width);
  const [menuCollapsed, setMenuCollapsed] = useState(initial.menuCollapsed);
  const [expanded, setExpanded] = useState(false);
  const [unread, setUnread] = useState(false);
  const [mounted, setMounted] = useState(enabled && initial.open);
  const [dragging, setDragging] = useState(false);
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  // The width transition is off for the first paint so a panel restored open does not
  // slide in again on every app switch; on from the next frame for the user's own opens.
  const [animate, setAnimate] = useState(false);
  const [panelIdentity, setPanelIdentity] = useState<(AiIdentity & { slug: string }) | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The panel holds a conversation in this tab (its `conversation` message). Open is
  // remembered across page loads only while it does: an idle panel does not follow the
  // person to the next app (panelState.ts).
  const [engaged, setEngaged] = useState(false);
  // Open came from the cookie, not from a click on this page. The cookie says a conversation
  // was live when the last page was left; if the panel then reports none (it went stale, or
  // it was another tab's), the restored panel closes again instead of sitting there empty.
  // Cleared by the first `conversation` message and by any toggle of the person's own.
  const restoredOpenRef = useRef(enabled && initial.open);
  const pageStore = useMemo(createPageStore, []);
  const actionStore = useMemo(createActionStore, []);
  // One host action at a time: a page with its approval dialog open answers a second request `busy`.
  const actionBusyRef = useRef(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const connRef = useRef<string | null>(null);
  const resetSentRef = useRef(false);

  const hostIdentity = useMemo(() => identityFromToken(orgToken), [orgToken]);
  const canDock = maxPanelWidth(viewport) >= PANEL_MIN_WIDTH;

  const status: AiPanelStatus = !mounted || !src
    ? "idle"
    : !loaded || !panelIdentity || !hostIdentity
      ? "loading"
      : panelIdentity.slug === slug && panelIdentity.account === hostIdentity.account && panelIdentity.org === hostIdentity.org
        ? "ready"
        : "mismatch";

  const post = useCallback(
    (msg: AiHostMessage) => {
      const win = iframeRef.current?.contentWindow;
      if (!win || !panelOrigin) return;
      win.postMessage(envelope(msg), panelOrigin);
    },
    [panelOrigin],
  );

  // Latest values for the message handler, which is registered once per connection target.
  const latest = useRef({ slug, lang, colorMode, palette, open, expanded, appId: opts.appId, pathname: opts.pathname, onNavigate: opts.onNavigate });
  latest.current = { slug, lang, colorMode, palette, open, expanded, appId: opts.appId, pathname: opts.pathname, onNavigate: opts.onNavigate };

  // The page as the panel hears it: the route merged with the page's own declaration
  // (pageCompose.ts). The version only grows, so the panel can drop a late message.
  const contextVersion = useRef(0);
  const composeContext = useCallback((): Omit<AiPageContext, "version"> | null => {
    const { appId, pathname } = latest.current;
    const path = pathname === undefined ? "/" : pagePath(pathname);
    return composePageContext({
      appId,
      pathname,
      path,
      routeEntity: appId ? pageEntityFromPath(appId, path) : null,
      declared: pageStore.current.value,
      actions: actionTypesFor(actionStore.current.value, pathname),
    });
  }, [pageStore, actionStore]);
  const postContext = useCallback(
    (snapshotFor?: string) => {
      const conn = connRef.current;
      const ctx = composeContext();
      if (!conn || !ctx) return;
      contextVersion.current += 1;
      const version = contextVersion.current;
      if (snapshotFor !== undefined) post({ type: "context-snapshot", conn, request: snapshotFor, ...ctx, version });
      else post({ type: "context", conn, ...ctx, version });
    },
    [composeContext, post],
  );

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A new iframe document (first load, reload, another org) starts a new connection.
  useEffect(() => {
    connRef.current = null;
    resetSentRef.current = false;
    setPanelIdentity(null);
    setLoaded(false);
    setEngaged(false);
  }, [src]);

  useEffect(() => {
    if (!enabled || !panelOrigin) return;
    const onMessage = (e: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow || e.origin !== panelOrigin) return;
      const msg = parsePanelMessage(e.data, connRef.current);
      if (!msg) return;
      const cur = latest.current;
      switch (msg.type) {
        case "loaded": {
          if (!cur.slug) return;
          const conn = newConnectionId();
          connRef.current = conn;
          resetSentRef.current = false;
          setPanelIdentity(null);
          setLoaded(true);
          setEngaged(false);
          post({
            type: "init",
            conn,
            slug: cur.slug,
            theme: { mode: cur.colorMode, palette: cur.palette },
            lang: cur.lang,
            visible: cur.open,
            expanded: cur.expanded,
          });
          return;
        }
        case "ready":
          setPanelIdentity({ account: msg.account, org: msg.org, slug: msg.slug });
          return;
        case "close":
          setOpenState(false);
          setExpanded(false);
          return;
        case "expand":
          setExpanded(true);
          return;
        case "collapse":
          setExpanded(false);
          return;
        case "unread":
          setUnread(msg.unread);
          return;
        case "conversation":
          setEngaged(msg.active);
          if (!msg.active && restoredOpenRef.current) {
            setOpenState(false);
            setExpanded(false);
          }
          restoredOpenRef.current = false;
          return;
        case "context-request":
          // A send is pending: answer from the latest committed page, not the debounced one.
          postContext(msg.request);
          return;
        case "action-request": {
          // The AI proposed; the page acts through the handler it registered for this type
          // (useAiPageActions), on this pathname, one at a time. The person decides in the
          // page's own dialog under their own token; the outcome per record goes back.
          const reply = (result: AiActionResult) => post({ type: "action-result", conn: msg.conn, request: msg.request, ...result });
          const req = normaliseActionRequest(msg);
          if (!req) {
            reply({ status: "failed" });
            return;
          }
          const entry = findAction(actionStore.current.value, req.action, cur.pathname);
          if (!entry) {
            reply({ status: "unsupported" });
            return;
          }
          if (actionBusyRef.current) {
            reply({ status: "busy" });
            return;
          }
          actionBusyRef.current = true;
          let run: Promise<AiActionResult>;
          try {
            run = entry.run(req);
          } catch {
            run = Promise.resolve({ status: "failed" });
          }
          run.then(
            (result) => reply(normaliseActionResult(result)),
            () => reply({ status: "failed" }),
          ).finally(() => {
            actionBusyRef.current = false;
          });
          return;
        }
        case "navigate": {
          const target = normaliseNavigate(msg);
          if (target) cur.onNavigate?.(target);
          return;
        }
        case "reset":
          setPanelIdentity(null);
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, panelOrigin, post, postContext, actionStore]);

  // A panel signed in as someone else, or for another org, is told so once and gets nothing more.
  useEffect(() => {
    if (status !== "mismatch" || !connRef.current || resetSentRef.current) return;
    resetSentRef.current = true;
    post({ type: "reset", conn: connRef.current, reason: "identity" });
  }, [status, post]);

  // Live theme and language, after the handshake.
  const ready = status === "ready";
  useEffect(() => {
    if (!ready || !connRef.current) return;
    post({ type: "theme", conn: connRef.current, theme: { mode: colorMode, palette } });
  }, [ready, colorMode, palette, post]);
  useEffect(() => {
    if (!ready || !connRef.current) return;
    post({ type: "lang", conn: connRef.current, lang });
  }, [ready, lang, post]);
  useEffect(() => {
    if (!ready || !connRef.current) return;
    post({ type: "visibility", conn: connRef.current, visible: open, expanded });
  }, [ready, open, expanded, post]);

  // Where the host is, after the handshake and on every route change, at once; and after
  // every change the page declares (a selection growing click by click), debounced. The
  // panel picks its starter chips and its "Looking at" chip from it.
  useEffect(() => {
    if (!ready) return;
    postContext();
  }, [ready, opts.appId, opts.pathname, postContext]);
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        postContext();
      }, CONTEXT_DEBOUNCE_MS);
    };
    const unsubscribe = pageStore.subscribe(schedule);
    const unsubscribeActions = actionStore.subscribe(schedule);
    return () => {
      unsubscribe();
      unsubscribeActions();
      if (timer) clearTimeout(timer);
    };
  }, [ready, pageStore, actionStore, postContext]);

  // Opening puts the cursor in the composer: focus the frame, then ask the panel to focus
  // its input. Closing hands focus back to the button.
  useEffect(() => {
    if (!open) return;
    if (!ready || !connRef.current) return;
    iframeRef.current?.focus();
    post({ type: "focus", conn: connRef.current });
  }, [open, ready, post]);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!enabled) return;
      restoredOpenRef.current = false;
      setOpenState(next);
      if (next) {
        setMounted(true);
        setUnread(false);
        if (!canDock) setExpanded(true);
      } else {
        setExpanded(false);
        buttonRef.current?.focus();
      }
    },
    [enabled, canDock],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  // Sizes are remembered as they are; open only while the panel holds a conversation.
  useEffect(() => {
    if (!enabled) return;
    writePanelState({ open: open && engaged, width, menuCollapsed });
  }, [enabled, open, engaged, width, menuCollapsed]);

  // ⌘J / Ctrl-J toggles the panel. Inside the iframe the panel forwards the same key.
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, toggle]);

  // Resize from the left edge. The handle captures the pointer; a transparent shield covers
  // the iframe meanwhile, or the frame swallows the pointer and the drag stops at its edge.
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const vw = window.innerWidth;
      const max = Math.max(PANEL_MIN_WIDTH, maxPanelWidth(vw));
      let last = startW;
      setDragging(true);
      const onMove = (ev: PointerEvent) => {
        last = startW + (startX - ev.clientX);
        // Follow the hand down to the snap point and a little past the maximum; the
        // release decides between close, dock and big chat.
        setWidth(Math.min(max + EXPAND_OVERSHOOT, Math.max(SNAP_CLOSE_WIDTH - 40, Math.round(last))));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setDragging(false);
        if (last < SNAP_CLOSE_WIDTH) {
          setWidth(clampPanelWidth(startW, vw));
          setOpen(false);
        } else if (last > max + EXPAND_OVERSHOOT) {
          setWidth(clampPanelWidth(startW, vw));
          setExpanded(true);
        } else {
          setWidth(clampPanelWidth(last, vw));
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [width, setOpen],
  );

  return {
    enabled,
    open,
    expanded: open && expanded,
    width,
    unread,
    status,
    toggle,
    setOpen,
    setExpanded,
    _: { src, panelOrigin, mounted, animate, dragging, canDock, iframeRef, buttonRef, startDrag, menuCollapsed, setMenuCollapsed, pageStore, actionStore },
  };
}

/**
 * Decision 1 of the panel plan: the docked panel pushes the page, and when the page would drop
 * under PAGE_MIN_WIDTH the left menu collapses to its rail (item 8: the threshold is the page,
 * not the viewport). The panel remembers that it did so in the third field of its state cookie,
 * so an app switch keeps the memory, and expands the menu again when it closes, unless the
 * person changed the menu themselves meanwhile. Renders nothing; lives inside SidebarProvider.
 */
export function PanelMenuFit({ ai }: { ai: AiPanel }) {
  const { collapsed, setCollapsed, width: menuWidth } = useSidebar();
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const docked = ai.enabled && ai.open && !ai.expanded;
  const { menuCollapsed, setMenuCollapsed } = ai._;
  // Read in the effect, not listed as a dependency: a menu the person reopens by hand while the
  // panel is docked stays open; only the panel's own changes (open, width) and the viewport fit again.
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  useEffect(() => {
    if (docked) {
      // Older ui2 has no adjustable width; treat it as the default and let the page decide.
      const menu = typeof menuWidth === "number" ? menuWidth : 256;
      if (!collapsedRef.current && viewport - menu - ai.width < PAGE_MIN_WIDTH) {
        setCollapsed(true);
        setMenuCollapsed(true);
      }
    } else if (menuCollapsed) {
      setMenuCollapsed(false);
      if (collapsedRef.current) setCollapsed(false);
    }
  }, [docked, ai.width, viewport, menuWidth, menuCollapsed, setCollapsed, setMenuCollapsed]);
  return null;
}

/** The AI button for the shell's top bar: toggles the panel, shows the unread dot. */
export function AiPanelButton({ ai, className }: { ai: AiPanel; className?: string }) {
  if (!ai.enabled || !ai._.src) return null;
  return (
    <Button
      ref={ai._.buttonRef}
      type="button"
      variant="ghost"
      size="icon"
      aria-label="AI"
      aria-pressed={ai.open}
      title="AI (⌘J)"
      onClick={ai.toggle}
      className={cn(
        "relative size-8 text-muted-foreground hover:text-foreground",
        ai.open && "bg-accent text-foreground",
        className,
      )}
    >
      <Sparkles />
      {ai.unread && !ai.open && (
        <span aria-hidden className="absolute right-1 top-1 size-2 rounded-full bg-primary ring-2 ring-card" />
      )}
    </Button>
  );
}

/**
 * The docked panel: a sibling of the page inside the shell's flex row. Its width
 * animates like the left sidebar (300 ms) and the iframe is anchored to the right edge,
 * so the content slides in rather than being uncovered. Hidden below md: the mobile
 * sheet is panel phase 1.
 */
export function AiPanelFrame({ ai }: { ai: AiPanel }) {
  if (!ai.enabled || !ai._.src) return null;
  const { src, mounted, animate, dragging, iframeRef, startDrag } = ai._;
  const docked = ai.open && !ai.expanded;
  return (
    <aside
      data-ai-panel={ai.open ? (ai.expanded ? "expanded" : "open") : "closed"}
      aria-label="AI"
      aria-hidden={!ai.open}
      className={cn(
        "relative hidden shrink-0 overflow-hidden bg-card md:flex",
        ai.open && "border-l border-border",
        ai.expanded && "flex-1",
        animate && !dragging && "transition-[width] duration-300 ease-in-out motion-reduce:transition-none",
      )}
      style={ai.expanded ? undefined : { width: ai.open ? ai.width : 0 }}
    >
      {docked && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize AI panel"
          onPointerDown={startDrag}
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-border active:bg-primary/40"
        />
      )}
      {mounted && (
        <iframe
          ref={iframeRef}
          src={src}
          title="AI"
          allow="microphone; clipboard-read; clipboard-write"
          className="absolute inset-y-0 right-0 h-full border-0 bg-card"
          style={{ width: ai.expanded ? "100%" : ai.width }}
        />
      )}
      {dragging && <div aria-hidden className="absolute inset-0 z-20 cursor-col-resize" />}
      {ai.status === "mismatch" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-card p-6 text-center text-sm text-muted-foreground">
          The AI panel is signed in as another account or organisation. Reload the page to continue.
        </div>
      )}
    </aside>
  );
}
