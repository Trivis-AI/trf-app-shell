// The framework-free half of live changes: the SSE line parser, the own-write
// window and the per-registration coalescer. Kept pure so it can be tested with
// node alone and read without React in the way. The React half is ./liveChanges.tsx.

export type LiveActor = "self" | "agent" | "other";

/** What the stream says about one write. Identity only, never values. */
export interface LiveChangeEvent {
  event_id: string;
  service: string;
  entity_type: string;
  entity_id: string;
  action: string;
  /** The writer's relation to this person: themselves (any tab), an agent acting for them, somebody else. */
  actor: LiveActor;
  occurred_at?: string;
  /**
   * This tab wrote it (markOwnWrite within the window). The page still
   * refetches, so a mixed batch converges, but it does not glow its own work.
   */
  local: boolean;
}

export type LiveRefreshReason = "external" | "local" | "resync";

/** One coalesced delivery to a registration. */
export interface LiveChangeBatch {
  /** "resync" after a gap in the signal; "external" when any event was not this tab's; otherwise "local". */
  reason: LiveRefreshReason;
  events: LiveChangeEvent[];
  /** Entity ids of the events that were not this tab's own, deduplicated. */
  ids: string[];
}

/* ── SSE parsing ─────────────────────────────────────────────────────────── */

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Incremental server-sent-events parser. Feed it chunks as they arrive; it
 * returns the complete messages and keeps the partial tail for the next chunk.
 * Comment lines (":...") and unknown fields are ignored, as the spec says.
 */
export class SseParser {
  private tail = "";
  private event = "";
  private data: string[] = [];

  push(chunk: string): SseMessage[] {
    const out: SseMessage[] = [];
    const text = this.tail + chunk;
    const lines = text.split(/\r\n|\r|\n/);
    this.tail = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") {
        if (this.data.length) out.push({ event: this.event || "message", data: this.data.join("\n") });
        this.event = "";
        this.data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") this.event = value;
      else if (field === "data") this.data.push(value);
    }
    return out;
  }
}

/* ── Own writes ──────────────────────────────────────────────────────────── */

/** How long after a page announces its own write the matching event counts as local. */
export const OWN_WRITE_WINDOW_MS = 5000;

export class OwnWrites {
  private readonly until = new Map<string, number>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  mark(entityType: string, id: string, windowMs = OWN_WRITE_WINDOW_MS): void {
    this.sweep();
    this.until.set(`${entityType}|${id}`, this.now() + windowMs);
  }

  has(entityType: string, id: string): boolean {
    const t = this.until.get(`${entityType}|${id}`);
    return t !== undefined && t >= this.now();
  }

  private sweep(): void {
    if (this.until.size < 64) return;
    const n = this.now();
    for (const [k, t] of this.until) if (t < n) this.until.delete(k);
  }
}

/* ── Coalescing ──────────────────────────────────────────────────────────── */

/** A registration delivers at most once per interval; events in between are unioned. */
export const COALESCE_MS = 500;

export interface CoalescerOptions {
  intervalMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Leading-and-trailing throttle for one registration: the first event in a
 * quiet period goes out at once, the rest of the burst goes out together when
 * the interval ends. A resync folds in and wins over everything else.
 */
export class Coalescer {
  private pending: LiveChangeEvent[] = [];
  private resync = false;
  private timer: unknown = null;
  private lastFlush = -Infinity;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly deliver: (batch: LiveChangeBatch) => void;

  constructor(deliver: (batch: LiveChangeBatch) => void, opts: CoalescerOptions = {}) {
    this.deliver = deliver;
    this.intervalMs = opts.intervalMs ?? COALESCE_MS;
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  add(event: LiveChangeEvent): void {
    this.pending.push(event);
    this.schedule();
  }

  askResync(): void {
    this.resync = true;
    this.schedule();
  }

  dispose(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.pending = [];
    this.resync = false;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastFlush + this.intervalMs - this.now());
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  private flush(): void {
    const events = this.pending;
    const resync = this.resync;
    this.pending = [];
    this.resync = false;
    this.lastFlush = this.now();
    if (!events.length && !resync) return;
    const external = events.filter((e) => !e.local);
    const reason: LiveRefreshReason = resync ? "resync" : external.length ? "external" : "local";
    const ids = Array.from(new Set(external.map((e) => e.entity_id)));
    this.deliver({ reason, events, ids });
  }
}

/* ── Backoff ─────────────────────────────────────────────────────────────── */

/** Reconnect delay for the n-th consecutive failure: 1 s doubling to 30 s, with jitter. */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.7 + 0.6 * random()));
}
