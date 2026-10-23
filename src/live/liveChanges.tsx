import * as React from "react";
import {
  Coalescer,
  OwnWrites,
  SseParser,
  reconnectDelay,
  type LiveChangeBatch,
  type LiveChangeEvent,
} from "./core";

export type { LiveChangeBatch, LiveChangeEvent, LiveRefreshReason, LiveActor } from "./core";

/**
 * Live changes: the shell keeps one server-sent-events stream per tab to the
 * discovery service (`GET /v1/changes/stream`, services), which forwards the
 * organisation's audit events as change identities. Pages register what they
 * show with `useLiveChanges` and refetch when something they show changed;
 * `markOwnWrite` keeps a page's own writes from glowing.
 *
 * Only the signal lives here. Refetching belongs to the page (react-query,
 * a loader), and the glow to the design system's table and field hooks.
 */

export type LiveStatus =
  /** No provider or no token yet. */
  | "idle"
  | "connecting"
  | "open"
  /** Lost the stream; retrying with backoff. The page works as without it. */
  | "reconnecting"
  /** The server has no stream (no NATS) or refused the token; retrying slowly. */
  | "unavailable";

export interface UseLiveChangesOptions {
  /** Audit entity types the page shows, e.g. ["purchase_invoice"]. "*" hears everything. */
  entityTypes: readonly string[];
  /** Called at most about twice a second with the events since the last call. */
  onChange: (batch: LiveChangeBatch) => void;
  /** Default true. False unregisters without unmounting. */
  enabled?: boolean;
}

interface Registration {
  types: Set<string>;
  coalescer: Coalescer;
}

interface LiveContextValue {
  status: LiveStatus;
  register: (r: Registration) => () => void;
}

const LiveContext = React.createContext<LiveContextValue | null>(null);

/* Own writes are module state so services and interceptors outside React can
   announce a write before sending it. One window per tab is right: it is this
   tab's writes the glow must skip. */
const ownWrites = new OwnWrites();

/**
 * Tell the shell this tab is about to write `entityType` `id`. Events for that
 * record in the next few seconds still refresh the page, marked local, so they
 * do not glow. Call it before the request goes out.
 */
export function markOwnWrite(entityType: string, id: string, windowMs?: number): void {
  if (!entityType || !id) return;
  ownWrites.mark(entityType, id, windowMs);
}

/** The discovery service's API base: the same derivation as the discovery client. */
export function servicesApiBase(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.hostname.split(".");
  if (parts.length < 2) return "/proxy/services-api";
  return `https://services-api.${parts.slice(-2).join(".")}`;
}

/** No message for this long means the stream is dead, heartbeats included (server sends one every 25 s). */
const SILENCE_MS = 45_000;

export interface LiveChangesProviderProps {
  /** The org token the stream authenticates with; null closes it. */
  token: string | null | undefined;
  /** Override the services API base (tests, unusual hosts). */
  apiBase?: string;
  children: React.ReactNode;
}

export function LiveChangesProvider({ token, apiBase, children }: LiveChangesProviderProps) {
  const [status, setStatus] = React.useState<LiveStatus>("idle");
  const regs = React.useRef(new Set<Registration>());

  const register = React.useCallback((r: Registration) => {
    regs.current.add(r);
    return () => {
      regs.current.delete(r);
      r.coalescer.dispose();
    };
  }, []);

  React.useEffect(() => {
    if (!token) {
      setStatus("idle");
      return;
    }
    const base = apiBase ?? servicesApiBase();
    let stopped = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const fanout = (fn: (r: Registration) => void) => {
      for (const r of regs.current) fn(r);
    };
    const resyncAll = () => fanout((r) => r.coalescer.askResync());

    const armWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => controller?.abort(), SILENCE_MS);
    };

    const scheduleRetry = (unavailable: boolean) => {
      if (stopped) return;
      attempt += 1;
      setStatus(unavailable ? "unavailable" : "reconnecting");
      const delay = unavailable ? 60_000 : reconnectDelay(attempt);
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const handle = (event: string, data: string) => {
      switch (event) {
        case "ready":
          attempt = 0;
          setStatus("open");
          // The gap between the page's own fetch and this subscription may hide
          // a write; one refetch covers it, and the same on every reconnect.
          resyncAll();
          return;
        case "change": {
          let e: Omit<LiveChangeEvent, "local">;
          try {
            e = JSON.parse(data);
          } catch {
            return;
          }
          if (!e || typeof e.entity_type !== "string" || typeof e.entity_id !== "string") return;
          const ev: LiveChangeEvent = { ...e, local: ownWrites.has(e.entity_type, e.entity_id) };
          fanout((r) => {
            if (r.types.has("*") || r.types.has(ev.entity_type)) r.coalescer.add(ev);
          });
          return;
        }
        case "resync":
          resyncAll();
          return;
        case "expired":
          // The token the stream was opened with ran out; the renewing token hook
          // delivers a new one, which reopens the stream through this effect.
          controller?.abort();
          return;
        default:
          return; // heartbeat and anything newer than this client
      }
    };

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      const { signal } = controller;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      let res: Response;
      try {
        res = await fetch(`${base}/v1/changes/stream`, {
          headers: { Bearer: token, Accept: "text/event-stream" },
          cache: "no-store",
          signal,
        });
      } catch {
        if (!signal.aborted) scheduleRetry(false);
        return;
      }
      if (!res.ok || !res.body) {
        // 401/403: the token is stale or this account may not listen; 404: a
        // cluster whose services does not have the route yet; 503: no NATS
        // behind it. None of them is worth hammering.
        scheduleRetry([401, 403, 404, 503].includes(res.status));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      armWatchdog();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          armWatchdog();
          for (const m of parser.push(decoder.decode(value, { stream: true }))) handle(m.event, m.data);
        }
      } catch {
        // aborted (watchdog, expiry, unmount) or network: fall through
      }
      if (watchdog) clearTimeout(watchdog);
      if (stopped) return;
      // A stream that closed after being open reconnects at once; the
      // reconnect's "ready" resyncs the pages.
      scheduleRetry(false);
    };

    void connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (watchdog) clearTimeout(watchdog);
      controller?.abort();
      setStatus("idle");
    };
  }, [token, apiBase]);

  const value = React.useMemo(() => ({ status, register }), [status, register]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/**
 * Register what the page shows and get told when it changed elsewhere. The
 * callback is read through a ref, so an inline function is fine.
 */
export function useLiveChanges({ entityTypes, onChange, enabled = true }: UseLiveChangesOptions): LiveStatus {
  const ctx = React.useContext(LiveContext);
  const cb = React.useRef(onChange);
  cb.current = onChange;
  const typesKey = entityTypes.join("|");
  React.useEffect(() => {
    if (!ctx || !enabled) return;
    const reg: Registration = {
      types: new Set(typesKey.split("|").filter(Boolean)),
      coalescer: new Coalescer((b) => cb.current(b)),
    };
    return ctx.register(reg);
  }, [ctx, enabled, typesKey]);
  return ctx?.status ?? "idle";
}

/** The stream's state, for a status indicator. */
export function useLiveChangesStatus(): LiveStatus {
  return React.useContext(LiveContext)?.status ?? "idle";
}
