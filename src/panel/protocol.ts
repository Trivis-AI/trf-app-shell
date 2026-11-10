// The bridge between a host page and the AI panel: frontai rendered in an iframe inside
// the shell. Plan: documentation/AI-SIDEPANEL-PLAN.md, section 4. Both sides import this
// file (frontai through @trf/app-shell), so the wire shape lives in one place.
//
// Every message carries the marker, the protocol version and, after the handshake, the
// connection id the host minted for this iframe load. A message from an older connection
// (an iframe that reloaded, an org that changed) is ignored by both sides. No credential
// ever travels here: the panel signs in for the org the host names and proves it in
// `ready` with the ids its own verified token carries.

export const AI_BRIDGE_MARKER = "trf-ai-panel";
export const AI_BRIDGE_VERSION = 1;

/** Oversized payloads are dropped unread; nothing on this bridge is big. */
export const AI_BRIDGE_MAX_BYTES = 64 * 1024;

export type AiColorMode = "light" | "dark" | "system";

export interface AiTheme {
  /** The stored preference, not the resolved class: the panel resolves "system" itself. */
  mode: AiColorMode;
  palette: string;
}

/** An entity the host's route names. Ids only: the agent reads the record itself. */
export interface AiPageEntity {
  type: string;
  id: string;
}

/**
 * A list the page shows (plan section 3.6): the rows' entity type, how the person has
 * narrowed it, which rows are on screen and how many match in all. Ids and filter values
 * only, never row data: the agent reads the records itself, so the page can neither feed
 * it stale numbers nor grant anything. Filter values are the person's own text and are
 * shown to the model as data.
 */
export interface AiPageList {
  type: string;
  filters?: Record<string, string>;
  visibleIds?: string[];
  total?: number;
}

/** The records the person has picked on the page; the selection may reach past the visible rows. */
export interface AiPageSelection {
  type: string;
  ids: string[];
}

/**
 * What a page declares about itself through `useAiPageContext`: its own key, the record it
 * shows, the list it shows and the selection on it. The shell adds the app, the route and
 * the version. A page that declares nothing is still described by its route (pageEntity.ts).
 */
export interface AiPageDeclaration {
  page: string;
  entity?: AiPageEntity;
  list?: AiPageList;
  selected?: AiPageSelection;
}

/**
 * Where the host is (documentation/AI-PANEL-ACTIONS.md, section 4.1): the app, the route
 * without the `/app/:slug` prefix, the entity the route names or the page declares, the
 * page's own declaration when it made one, and a version that grows with every change so a
 * late message never replaces a newer one.
 */
export interface AiPageContext {
  app: string;
  path: string;
  entity?: AiPageEntity;
  page?: string;
  list?: AiPageList;
  selected?: AiPageSelection;
  /** Action types the page can carry out for the panel (useAiPageActions), sorted. */
  actions?: string[];
  version: number;
}

/*
 * Host actions (documentation/AI-SIDEPANEL-PLAN.md, 3.8): the AI proposes, the page acts.
 * The panel posts `action-request` with the records and, per record, what the AI proposes
 * and why; the host runs the handler the page registered for that action type, which shows
 * the page's own dialog, and the person decides there under their own token. The outcome
 * per record goes back as `action-result`. Reasons are the model's text: shown as data,
 * never run. A request for an action the page did not register is answered `unsupported`.
 */

/** One record in a host action, with what the AI proposes for it. */
export interface AiActionItem {
  id: string;
  /** The proposed verdict, in the action's own vocabulary (approve, hold). */
  verdict?: string;
  reason?: string;
}

export interface AiActionRequest {
  /** The action type the page registered, e.g. "approve_purchase_invoices". */
  action: string;
  /** The records' entity type, e.g. "purchase_invoice". */
  entity: string;
  items: AiActionItem[];
  /** The AI's one-line summary of the proposal. */
  note?: string;
}

export type AiActionItemStatus = "done" | "skipped" | "conflict" | "failed";

export interface AiActionItemResult {
  id: string;
  status: AiActionItemStatus;
  /** A translation key or a short note: why it was skipped, what the server said. */
  detail?: string;
}

export type AiActionStatus =
  /** The person acted; `items` says what happened to each record. */
  | "done"
  /** The person closed the dialog without acting. */
  | "cancelled"
  /** The page registered no handler for this action type. */
  | "unsupported"
  /** Another action is still open on the page. */
  | "busy"
  /** The handler threw, or the request was malformed. */
  | "failed";

export interface AiActionResult {
  status: AiActionStatus;
  items?: AiActionItemResult[];
}

/** Where the panel asks the host to go: a route without the `/app/:slug` prefix, in this app or another. */
export interface AiNavigateTarget {
  /** The app id (shell `appId`, e.g. "purchase"); absent for this app. */
  app?: string;
  path: string;
}

/**
 * The two places the conversation can live (extension docs/PLAN.md section 9): the App panel,
 * this iframe docked in the shell, and the Chrome panel, the Trivis Chrome extension's side
 * panel, which embeds the same route. `toChrome`: the App panel may move into the Chrome
 * panel. `toApp`: the Chrome panel may move into the App panel of the Trivis tab it is next to.
 */
export interface AiPanelMoves {
  toChrome: boolean;
  toApp: boolean;
}

/*
 * A look at the web page in the browser tab (extension docs/PLAN.md section 10). Only the
 * Chrome panel's host offers it: the Trivis extension reads the page in the tab the panel sits
 * next to, once, when the person presses the eye, and hands the read to the panel, which
 * uploads it under the person's own session. The shell never sends `look`, so the App panel
 * shows no eye. The read travels as a Blob beside the message's own fields: the size bound on
 * the bridge counts the fields, and `look-result` bounds the Blob itself.
 */

/** Whether the host can look at the tab right now; `reason` says why not ("restricted"). */
export interface AiLookOffer {
  available: boolean;
  reason?: string;
}

/** What the host is waiting for or doing with a look: the toolbar icon, or reading the page. */
export type AiLookState = "icon" | "reading";

export type AiLookStatus =
  /** The page was read; `blob` holds it. */
  | "ok"
  /** The person did not allow the site, or did not click the toolbar icon in time. */
  | "denied"
  /** A page that must not or cannot be read: Chrome's own pages, a payment or code screen. */
  | "blocked"
  /** More text than one look carries; the person selects a part and looks again. */
  | "too_large"
  /** Nothing readable on the page. */
  | "empty"
  | "failed";

/** The page a look read: its address, its title and the site as the person knows it. */
export interface AiLookPage {
  url: string;
  title: string;
  site: string;
}

/**
 * A control of the page a look read: a button, a link or a form field, by its number in the
 * look's list and its label. Never a field's value. The panel shows the label where the
 * assistant names a control, and asks the host to point at it by the number.
 */
export interface AiLookControl {
  n: number;
  kind: "button" | "link" | "field";
  label: string;
}

/** Why a control could not be pointed at: no such number, the tab is elsewhere, or the page no longer has it. */
export type AiPointReason = "unknown" | "moved" | "gone" | "unreachable";

export interface AiLookResult {
  status: AiLookStatus;
  /** Why, for a status that is not "ok": "site", "timeout", "restricted", "secret", ... */
  reason?: string;
  page?: AiLookPage;
  /** "page": `blob` is the page's text. "file": `blob` is the file the tab shows (a PDF), named `name`. */
  kind?: "page" | "file";
  blob?: Blob;
  name?: string;
  /** The page's controls as the look listed them, for pointing at one by its number. */
  controls?: AiLookControl[];
}

/** The largest text of a page one look carries, and the largest file (a PDF in the tab). */
export const AI_LOOK_MAX_TEXT_BYTES = 100 * 1024;
export const AI_LOOK_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Page to panel. */
export type AiHostMessage =
  | { type: "init"; conn: string; slug: string; theme: AiTheme; lang: string; visible: boolean; expanded: boolean }
  | { type: "theme"; conn: string; theme: AiTheme }
  | { type: "lang"; conn: string; lang: string }
  | { type: "focus"; conn: string }
  | { type: "visibility"; conn: string; visible: boolean; expanded: boolean }
  /** The debounced context, for the chip and the starter chips. */
  | ({ type: "context"; conn: string } & AiPageContext)
  /** The answer to `context-request`: the page as it is at this moment, for one send. */
  | ({ type: "context-snapshot"; conn: string; request: string } & AiPageContext)
  /** The outcome of an `action-request`, with the same request id, once the person has acted. */
  | ({ type: "action-result"; conn: string; request: string } & AiActionResult)
  /** Which moves between the App panel and the Chrome panel the host offers right now. */
  | ({ type: "moves"; conn: string } & AiPanelMoves)
  /** Whether the host can look at the page in the tab; only the Chrome panel's host says so. */
  | ({ type: "look"; conn: string } & AiLookOffer)
  /** A look the panel asked for is waiting for the person, or under way. */
  | { type: "look-progress"; conn: string; request: string; state: AiLookState }
  /** The outcome of a `look-request`, with the same request id. */
  | ({ type: "look-result"; conn: string; request: string } & AiLookResult)
  /**
   * While the panel follows a tab (`look-follow`): the page in that tab changed, so the
   * panel may look again. `left`: the tab is no longer on the site that is followed, or the
   * panel sits next to another tab, and following is over.
   */
  | { type: "look-changed"; conn: string; left?: boolean }
  /** The outcome of a `point`: whether the control was found and ringed, and its label. */
  | { type: "point-result"; conn: string; request: string; pointed: boolean; reason?: AiPointReason; label?: string }
  | { type: "reset"; conn: string; reason: string };

/** Panel to page. */
export type AiPanelMessage =
  | { type: "loaded" }
  | { type: "ready"; conn: string; account: string; org: string; slug: string }
  | { type: "close"; conn: string }
  | { type: "expand"; conn: string }
  | { type: "collapse"; conn: string }
  | { type: "unread"; conn: string; unread: boolean }
  /** Whether the panel holds a conversation in this tab; the host remembers open only while it does. */
  | { type: "conversation"; conn: string; active: boolean }
  /** A send is pending: asks for a fresh snapshot of the page, answered with the same request id. */
  | { type: "context-request"; conn: string; request: string }
  /** Asks the page to carry out a proposal through its own dialog; answered with `action-result`. */
  | ({ type: "action-request"; conn: string; request: string } & AiActionRequest)
  /** Asks the host to open a route, in this app or another; validated by the host. */
  | ({ type: "navigate"; conn: string } & AiNavigateTarget)
  /** Moves this conversation into the other panel; `session` is the conversation, null for a fresh one. */
  | { type: "move"; conn: string; to: "chrome" | "app"; session: string | null }
  /**
   * The person pressed the eye: look at the page in the tab; posted inside the click. With
   * `site` (while following a tab) the page is read only if the tab is still on that site.
   */
  | { type: "look-request"; conn: string; request: string; site?: string }
  /**
   * Following a tab (extension docs/PLAN.md section 10, guiding): the person asked to be
   * walked through a flow on `site`. While it is on, the host keeps a steady frame on that
   * tab's page and says `look-changed` after each page change there. Reading stays with
   * `look-request`. Off, or the tab leaving the site, ends it.
   */
  | { type: "look-follow"; conn: string; on: boolean; site?: string }
  /** The panel is done with a look (answered, failed or taken back): the host stops showing it. */
  | { type: "look-end"; conn: string; request: string }
  /**
   * Asks the host to point at a control of the page a look read: `look` is that look's
   * request id, `control` the number in its list. The host scrolls to it and rings it for a
   * few seconds; nothing is pressed. Answered with `point-result`.
   */
  | { type: "point"; conn: string; request: string; look: string; control: number }
  | { type: "reset"; conn: string; reason: string };

type Envelope = { trf: typeof AI_BRIDGE_MARKER; v: typeof AI_BRIDGE_VERSION };

export function envelope<T extends object>(msg: T): T & Envelope {
  return { trf: AI_BRIDGE_MARKER, v: AI_BRIDGE_VERSION, ...msg };
}

const HOST_TYPES = new Set(["init", "theme", "lang", "focus", "visibility", "context", "context-snapshot", "action-result", "moves", "look", "look-progress", "look-result", "look-changed", "point-result", "reset"]);
const PANEL_TYPES = new Set(["loaded", "ready", "close", "expand", "collapse", "unread", "conversation", "context-request", "action-request", "navigate", "move", "look-request", "look-end", "look-follow", "point", "reset"]);
const LOOK_STATUSES = new Set(["ok", "denied", "blocked", "too_large", "empty", "failed"]);

/**
 * Checks the parts of a `look-result` the size bound does not see: a known status, and for
 * "ok" a Blob within the bound for its kind. A Blob serialises to "{}", so the bridge's own
 * bound counts only the fields around it.
 */
function validLookResult(m: Record<string, unknown>): boolean {
  if (typeof m.request !== "string" || m.request === "") return false;
  if (typeof m.status !== "string" || !LOOK_STATUSES.has(m.status)) return false;
  if (m.status !== "ok") return m.blob === undefined;
  if (typeof Blob === "undefined" || !(m.blob instanceof Blob) || m.blob.size === 0) return false;
  if (m.kind === "page") return m.blob.size <= AI_LOOK_MAX_TEXT_BYTES;
  if (m.kind === "file") return m.blob.size <= AI_LOOK_MAX_FILE_BYTES && typeof m.name === "string" && m.name !== "";
  return false;
}

/**
 * Unwraps a bridge message, or returns null for anything else: other postMessage
 * traffic on the page, another protocol version, an unknown type, an oversized
 * payload, or a message from a connection that is not `conn` (every type but the
 * panel's `loaded`, which is what starts a connection).
 */
function parse(data: unknown, types: Set<string>, conn: string | null): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.trf !== AI_BRIDGE_MARKER || m.v !== AI_BRIDGE_VERSION) return null;
  if (typeof m.type !== "string" || !types.has(m.type)) return null;
  try {
    if (JSON.stringify(m).length > AI_BRIDGE_MAX_BYTES) return null;
  } catch {
    return null;
  }
  if (m.type === "loaded") return m;
  if (typeof m.conn !== "string" || m.conn === "" || m.conn !== conn) return null;
  return m;
}

export function parsePanelMessage(data: unknown, conn: string | null): AiPanelMessage | null {
  return parse(data, PANEL_TYPES, conn) as AiPanelMessage | null;
}

export function parseHostMessage(data: unknown, conn: string | null): AiHostMessage | null {
  // `init` carries the connection id the panel does not know yet.
  if (data && typeof data === "object" && (data as { type?: unknown }).type === "init") {
    const m = parse(data, HOST_TYPES, typeof (data as { conn?: unknown }).conn === "string" ? (data as { conn: string }).conn : null);
    return m as AiHostMessage | null;
  }
  const m = parse(data, HOST_TYPES, conn);
  if (m && m.type === "look-result" && !validLookResult(m)) return null;
  return m as AiHostMessage | null;
}

export function newConnectionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The account and organisation ids a TRF org token names (trflib auth.Claims: a.i, o.i). */
export interface AiIdentity {
  account: string;
  org: string;
}

export function identityFromToken(token: string | null | undefined): AiIdentity | null {
  if (!token) return null;
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { a?: { i?: string }; o?: { i?: string } };
    const account = claims.a?.i;
    const org = claims.o?.i;
    return account && org ? { account, org } : null;
  } catch {
    return null;
  }
}

/** The route of the panel inside the AI app for an organisation. */
export function aiPanelPath(slug: string): string {
  return `/app/${encodeURIComponent(slug)}/panel`;
}

/** The origin the panel is embedded in, as the browser reports it; null outside an iframe. */
export function embeddingOrigin(): string | null {
  if (typeof window === "undefined" || window.parent === window) return null;
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length > 0) return ancestors[0];
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}
