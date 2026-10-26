// The pure half of the panel's remembered state: sizes, the two cookie names and the
// parser. No imports, so `node --test` runs panelState.test.ts without a bundler;
// panelState.ts adds the document reads and writes.

export const PANEL_DEFAULT_WIDTH = 400;
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 560;
/** The least the page gets beside a docked panel. */
export const PAGE_MIN_WIDTH = 720;
/** The collapsed left menu (ui2 sidebar.tsx SIDEBAR_WIDTH_ICON). */
export const RAIL_WIDTH = 56;
/** Dragging the panel narrower than this closes it. */
export const SNAP_CLOSE_WIDTH = 280;
/** Dragging this far past the maximum expands to big chat. */
export const EXPAND_OVERSHOOT = 80;

/** Width and the menu flag, for a year: `open.width.menu`. */
export const SIZES_COOKIE = "trf-ai-panel";
/**
 * Open, until the browser closes, and written by the host only while the panel holds a
 * conversation in this tab (AiPanel.tsx, the panel's `conversation` message). An idle
 * panel, opened and left with its starter chips, stays while the person moves inside one
 * app, since those are client-side route changes, and is gone on the next full load:
 * another app, a reload, tomorrow. The first field of the sizes cookie carries the same
 * value for apps still on app-shell 0.46.0 and is not read since 0.47.0.
 */
export const OPEN_COOKIE = "trf-ai-panel-open";

export interface PanelState {
  open: boolean;
  width: number;
  /** The panel collapsed the left menu to make room; it expands it again when it closes. */
  menuCollapsed: boolean;
}

/** The widest the panel may dock at in this viewport; below PANEL_MIN_WIDTH it cannot dock. */
export function maxPanelWidth(viewportWidth: number): number {
  return Math.min(PANEL_MAX_WIDTH, viewportWidth - RAIL_WIDTH - PAGE_MIN_WIDTH);
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, maxPanelWidth(viewportWidth));
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

/** The cookie header parsed; `readPanelState` feeds it `document.cookie`. */
export function parsePanelState(cookie: string): PanelState {
  const closed: PanelState = { open: false, width: PANEL_DEFAULT_WIDTH, menuCollapsed: false };
  const open = new RegExp(`(?:^|; )${OPEN_COOKIE}=1(?:;|$)`).test(cookie);
  const m = cookie.match(new RegExp(`(?:^|; )${SIZES_COOKIE}=([^;]*)`));
  if (!m) return { ...closed, open };
  // `open.width.menu`; the third field arrived with the menu auto-collapse and may be absent.
  const [, width, menu] = decodeURIComponent(m[1]).split(".");
  const w = Number(width);
  return {
    open,
    width: Number.isFinite(w) && w >= PANEL_MIN_WIDTH && w <= PANEL_MAX_WIDTH ? w : PANEL_DEFAULT_WIDTH,
    menuCollapsed: menu === "1",
  };
}
