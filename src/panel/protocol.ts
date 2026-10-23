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

/** Page to panel. */
export type AiHostMessage =
  | { type: "init"; conn: string; slug: string; theme: AiTheme; lang: string; visible: boolean; expanded: boolean }
  | { type: "theme"; conn: string; theme: AiTheme }
  | { type: "lang"; conn: string; lang: string }
  | { type: "focus"; conn: string }
  | { type: "visibility"; conn: string; visible: boolean; expanded: boolean }
  | { type: "reset"; conn: string; reason: string };

/** Panel to page. */
export type AiPanelMessage =
  | { type: "loaded" }
  | { type: "ready"; conn: string; account: string; org: string; slug: string }
  | { type: "close"; conn: string }
  | { type: "expand"; conn: string }
  | { type: "collapse"; conn: string }
  | { type: "unread"; conn: string; unread: boolean }
  | { type: "reset"; conn: string; reason: string };

type Envelope = { trf: typeof AI_BRIDGE_MARKER; v: typeof AI_BRIDGE_VERSION };

export function envelope<T extends object>(msg: T): T & Envelope {
  return { trf: AI_BRIDGE_MARKER, v: AI_BRIDGE_VERSION, ...msg };
}

const HOST_TYPES = new Set(["init", "theme", "lang", "focus", "visibility", "reset"]);
const PANEL_TYPES = new Set(["loaded", "ready", "close", "expand", "collapse", "unread", "reset"]);

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
  return parse(data, HOST_TYPES, conn) as AiHostMessage | null;
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
