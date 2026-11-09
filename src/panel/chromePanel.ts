// The Chrome panel: the Trivis Chrome extension's side panel, which embeds the same panel
// route as the App panel (the iframe this shell docks). When the extension is installed the
// shell talks to it, so the person never has the two open at once (extension
// docs/PLAN.md section 9):
//
//   mode "always": the AI button and ⌘J open the Chrome panel; the App panel stays shut.
//   mode "move":   the App panel works as before, with a button to move the conversation
//                  into the Chrome panel and, from there, back.
//
// The mode lives in the extension (its Bank view has the switch while this is being tried).
// Either way, while the Chrome panel looks at this tab the shell feeds it the page, as it
// feeds the App panel: context, the send-time snapshot, host actions and navigate.
//
// Mechanics, verified in Chrome 156 (2026-11-09): a page the extension lists in
// `externally_connectable` gets `chrome.runtime`; `sendMessage` answers whether it is
// installed; `sidePanel.open` works only inside a click or key press, including a click in
// the App panel's iframe passed up by postMessage, and is refused otherwise. So open is
// called from the handler itself, never after an await. No credential crosses this channel.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiActionRequest, AiActionResult, AiNavigateTarget, AiPageContext } from "./protocol";

export type ChromePanelMode = "always" | "move";

/**
 * The Trivis extension's IDs per environment: the unpacked development ID (its manifest pins
 * the key) on staging and in local development, the Web Store ID in production once it
 * exists. frontai's panel uses the same list for who may embed it.
 */
const EXTENSION_IDS: Record<string, readonly string[]> = {
  "trf.is": ["fhedlbeinaimjdehdcpbakdkdflcgoil"],
  "trivis.ee": [],
};

export function trivisExtensionIds(hostname: string): string[] {
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  const apex = local ? "trf.is" : hostname.split(".").slice(-2).join(".");
  return [...(EXTENSION_IDS[apex] ?? [])];
}

/** Page to extension, over the port. */
export type ShellToExtension =
  | { type: "hello"; slug: string; account: string; org: string; app: string }
  | ({ type: "context" } & AiPageContext)
  | ({ type: "context-snapshot"; request: string } & AiPageContext)
  | ({ type: "action-result"; request: string } & AiActionResult);

/** Extension to page, over the port. */
export type ExtensionToShell =
  /** Whether the Chrome panel is open in this window, and whether it is looking at this tab. */
  | { type: "state"; mode: ChromePanelMode; open: boolean; active: boolean }
  | { type: "context-request"; request: string }
  | ({ type: "action-request"; request: string } & AiActionRequest)
  | ({ type: "navigate" } & AiNavigateTarget)
  /** The conversation moves from the Chrome panel into this tab's App panel. */
  | { type: "open-app-panel"; session: string | null };

const MAX_BYTES = 64 * 1024;
const EXT_TYPES = new Set(["state", "context-request", "action-request", "navigate", "open-app-panel"]);

/** Checks a message from the extension's port; null for anything else. */
export function parseExtensionMessage(data: unknown): ExtensionToShell | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (typeof m.type !== "string" || !EXT_TYPES.has(m.type)) return null;
  try {
    if (JSON.stringify(m).length > MAX_BYTES) return null;
  } catch {
    return null;
  }
  switch (m.type) {
    case "state":
      if ((m.mode !== "always" && m.mode !== "move") || typeof m.open !== "boolean" || typeof m.active !== "boolean") return null;
      return { type: "state", mode: m.mode, open: m.open, active: m.active };
    case "context-request":
      return typeof m.request === "string" && m.request ? { type: "context-request", request: m.request } : null;
    case "open-app-panel":
      return { type: "open-app-panel", session: typeof m.session === "string" && m.session ? m.session : null };
    default:
      // action-request and navigate are checked further by hostActions.ts, as from the iframe.
      return m as ExtensionToShell;
  }
}

/** Whether the Chrome panel stands in for the App panel right now. */
export function chromeTakesOver(s: { available: boolean | null; mode: ChromePanelMode; open: boolean }): boolean {
  return s.available === true && (s.mode === "always" || s.open);
}

// The slice of the extension API a page gets through externally_connectable. Typed here so
// the shell needs no @types/chrome.
interface ExtPort {
  postMessage(msg: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (msg: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}
interface ExtRuntime {
  sendMessage(id: string, msg: unknown, cb: (reply: unknown) => void): void;
  connect(id: string, info: { name: string }): ExtPort;
  lastError?: { message?: string };
}

function extRuntime(): ExtRuntime | null {
  if (typeof globalThis === "undefined") return null;
  const rt = (globalThis as { chrome?: { runtime?: Partial<ExtRuntime> } }).chrome?.runtime;
  return rt && typeof rt.sendMessage === "function" && typeof rt.connect === "function" ? (rt as ExtRuntime) : null;
}

/**
 * True when some extension lists this page in externally_connectable and a Trivis ID is
 * known here: worth holding a restored App panel for the answer, so it does not flash open
 * and shut again when the Chrome panel takes over.
 */
export function mayHaveTrivisExtension(): boolean {
  if (typeof window === "undefined") return false;
  return extRuntime() !== null && trivisExtensionIds(window.location.hostname).length > 0;
}

function ask(rt: ExtRuntime, id: string, msg: unknown, timeoutMs: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      rt.sendMessage(id, msg, (reply) => {
        clearTimeout(timer);
        // Reading lastError is what tells Chrome it was handled: no such extension here.
        if (rt.lastError) return resolve(null);
        resolve(reply && typeof reply === "object" ? (reply as Record<string, unknown>) : null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export interface ChromePanel {
  /** null while asking; false when no Trivis extension answered here. */
  available: boolean | null;
  mode: ChromePanelMode;
  /** The Chrome panel is open in this window. */
  open: boolean;
  /** The Chrome panel is looking at this tab: feed it the page. */
  active: boolean;
  /** Opens the Chrome panel on this conversation. Call it inside a click or key handler. */
  openPanel: (session: string | null, done?: (opened: boolean) => void) => void;
  closePanel: () => void;
  send: (msg: ShellToExtension) => void;
}

export interface ChromePanelOptions {
  enabled: boolean;
  /** Who this tab is: the org in the route and the ids the shell's own token carries. */
  hello: { slug: string; account: string; org: string; app: string } | null;
  onMessage: (msg: Exclude<ExtensionToShell, { type: "state" }>) => void;
}

const RECONNECT_MS = 1000;

export function useChromePanel(opts: ChromePanelOptions): ChromePanel {
  const { enabled } = opts;
  const [available, setAvailable] = useState<boolean | null>(() => (enabled && mayHaveTrivisExtension() ? null : false));
  const [extId, setExtId] = useState<string | null>(null);
  const [state, setState] = useState<{ mode: ChromePanelMode; open: boolean; active: boolean }>({ mode: "always", open: false, active: false });
  const portRef = useRef<ExtPort | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  // Which Trivis extension answers here, if any.
  useEffect(() => {
    if (!enabled || available === false) return;
    const rt = extRuntime();
    if (!rt) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const id of trivisExtensionIds(window.location.hostname)) {
        const reply = await ask(rt, id, { type: "ping" }, 1500);
        if (cancelled) return;
        if (reply?.ok === true) {
          setExtId(id);
          if (reply.mode === "always" || reply.mode === "move") setState((s) => ({ ...s, mode: reply.mode as ChromePanelMode }));
          setAvailable(true);
          return;
        }
      }
      if (!cancelled) setAvailable(false);
    })();
    return () => {
      cancelled = true;
    };
    // Asked once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // A long-lived port for state and the relay. The extension's worker may be stopped while
  // idle, which drops the port; connecting again wakes it.
  useEffect(() => {
    if (!enabled || !extId) return;
    const rt = extRuntime();
    if (!rt) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      let port: ExtPort;
      try {
        port = rt.connect(extId, { name: "trf-shell" });
      } catch {
        retry = setTimeout(connect, RECONNECT_MS);
        return;
      }
      portRef.current = port;
      port.onMessage.addListener((raw) => {
        const msg = parseExtensionMessage(raw);
        if (!msg) return;
        if (msg.type === "state") setState({ mode: msg.mode, open: msg.open, active: msg.active });
        else latest.current.onMessage(msg);
      });
      port.onDisconnect.addListener(() => {
        void rt.lastError;
        if (portRef.current === port) portRef.current = null;
        if (!stopped) retry = setTimeout(connect, RECONNECT_MS);
      });
      const hello = latest.current.hello;
      if (hello) port.postMessage({ type: "hello", ...hello });
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, [enabled, extId]);

  // Tell the extension again when the org or the app changes under the same page.
  const helloKey = opts.hello ? `${opts.hello.slug}|${opts.hello.account}|${opts.hello.org}|${opts.hello.app}` : "";
  useEffect(() => {
    const hello = latest.current.hello;
    if (hello) portRef.current?.postMessage({ type: "hello", ...hello });
  }, [helloKey]);

  const openPanel = useCallback(
    (session: string | null, done?: (opened: boolean) => void) => {
      const rt = extRuntime();
      if (!rt || !extId) return done?.(false);
      // Synchronously, inside the person's click or key press: Chrome refuses otherwise.
      rt.sendMessage(extId, { type: "open-chrome-panel", session, slug: latest.current.hello?.slug ?? null }, (reply) => {
        void rt.lastError;
        done?.(!!reply && typeof reply === "object" && (reply as { opened?: unknown }).opened === true);
      });
    },
    [extId],
  );
  const closePanel = useCallback(() => {
    const rt = extRuntime();
    if (!rt || !extId) return;
    rt.sendMessage(extId, { type: "close-chrome-panel" }, () => void rt.lastError);
  }, [extId]);
  const send = useCallback((msg: ShellToExtension) => portRef.current?.postMessage(msg), []);

  return { available: enabled ? available : false, mode: state.mode, open: state.open, active: state.active, openPanel, closePanel, send };
}
