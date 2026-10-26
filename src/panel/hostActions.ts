// What the host accepts from the panel before it acts on it (documentation/AI-SIDEPANEL-PLAN.md,
// 3.8 and 4): an `action-request` is cut to a bounded, plain shape, a `navigate` to a route of
// ours. Pure and import-light, so `node --test` runs the tests. The reasons in a request are the
// model's own text and stay data: bounded here, shown quoted by the page, never interpreted.

import type { AiActionItem, AiActionItemResult, AiActionRequest, AiActionResult, AiNavigateTarget } from "./protocol";

export const ACTION_MAX_ITEMS = 500;
export const ACTION_MAX_ID = 64;
export const ACTION_MAX_VERDICT = 32;
export const ACTION_MAX_REASON = 500;
export const ACTION_MAX_NOTE = 1000;
export const NAVIGATE_MAX_PATH = 512;

const KEY_RE = /^[a-z][a-z0-9_]{0,47}$/;
const APP_RE = /^[a-z][a-z0-9-]{0,31}$/;
// A route of ours: one leading slash, no scheme, no second slash at the start (which a
// browser reads as another host), no parent segments, nothing but URL characters.
const PATH_RE = /^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*(\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;

const ITEM_STATUSES = new Set<AiActionItemResult["status"]>(["done", "skipped", "conflict", "failed"]);
const RESULT_STATUSES = new Set<AiActionResult["status"]>(["done", "cancelled", "unsupported", "busy", "failed"]);

/** Removes control characters and cuts to `max` code points; undefined for nothing left. */
function plain(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  let out = "";
  let n = 0;
  for (const ch of v) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) continue;
    if (n >= max) break;
    out += ch;
    n++;
  }
  out = out.trim();
  return out === "" ? undefined : out;
}

/** The request as the host acts on it, or null when the message is not one it should act on. */
export function normaliseActionRequest(msg: unknown): AiActionRequest | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.action !== "string" || !KEY_RE.test(m.action)) return null;
  if (typeof m.entity !== "string" || !KEY_RE.test(m.entity)) return null;
  if (!Array.isArray(m.items) || m.items.length === 0 || m.items.length > ACTION_MAX_ITEMS) return null;
  const items: AiActionItem[] = [];
  const seen = new Set<string>();
  for (const raw of m.items) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const id = plain(r.id, ACTION_MAX_ID + 1);
    if (!id || id.length > ACTION_MAX_ID || seen.has(id)) return null;
    seen.add(id);
    const item: AiActionItem = { id };
    const verdict = plain(r.verdict, ACTION_MAX_VERDICT);
    if (verdict) item.verdict = verdict;
    const reason = plain(r.reason, ACTION_MAX_REASON);
    if (reason) item.reason = reason;
    items.push(item);
  }
  const req: AiActionRequest = { action: m.action, entity: m.entity, items };
  const note = plain(m.note, ACTION_MAX_NOTE);
  if (note) req.note = note;
  return req;
}

/** The handler's answer as it goes back over the bridge: known statuses, bounded details. */
export function normaliseActionResult(res: unknown): AiActionResult {
  if (!res || typeof res !== "object") return { status: "failed" };
  const r = res as Record<string, unknown>;
  if (typeof r.status !== "string" || !RESULT_STATUSES.has(r.status as AiActionResult["status"])) return { status: "failed" };
  const out: AiActionResult = { status: r.status as AiActionResult["status"] };
  if (Array.isArray(r.items)) {
    const items: AiActionItemResult[] = [];
    for (const raw of r.items.slice(0, ACTION_MAX_ITEMS)) {
      if (!raw || typeof raw !== "object") continue;
      const i = raw as Record<string, unknown>;
      const id = plain(i.id, ACTION_MAX_ID + 1);
      if (!id || id.length > ACTION_MAX_ID) continue;
      if (typeof i.status !== "string" || !ITEM_STATUSES.has(i.status as AiActionItemResult["status"])) continue;
      const item: AiActionItemResult = { id, status: i.status as AiActionItemResult["status"] };
      const detail = plain(i.detail, ACTION_MAX_REASON);
      if (detail) item.detail = detail;
      items.push(item);
    }
    out.items = items;
  }
  return out;
}

/** A navigation the host may carry out, or null. */
export function normaliseNavigate(msg: unknown): AiNavigateTarget | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.path !== "string" || m.path.length > NAVIGATE_MAX_PATH || !PATH_RE.test(m.path)) return null;
  if (m.path.split("/").some((seg) => seg === "..")) return null;
  const target: AiNavigateTarget = { path: m.path };
  if (m.app !== undefined) {
    if (typeof m.app !== "string" || !APP_RE.test(m.app)) return null;
    target.app = m.app;
  }
  return target;
}

/** The action types a page offers right now: those registered on this pathname, sorted, each once. */
export function actionTypesFor(entries: ReadonlyArray<{ type: string; pathname: string }>, pathname: string | undefined): string[] {
  if (pathname === undefined) return [];
  const types = new Set<string>();
  for (const e of entries) if (e.pathname === pathname) types.add(e.type);
  return [...types].sort();
}
