// What the AI panel remembers between page loads. Moving between apps is a full page
// load on another origin, so the state sits in a cookie on the apex domain, like the
// theme (appearance.ts), and every app reads the same value. Sizes are the plan's
// section 3.2 numbers; the comments there say which ones are still to tune on screen.

import { cookieAttrs } from "../appearance";

const COOKIE = "trf-ai-panel";

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

export interface PanelState {
  open: boolean;
  width: number;
}

/** The widest the panel may dock at in this viewport; below PANEL_MIN_WIDTH it cannot dock. */
export function maxPanelWidth(viewportWidth: number): number {
  return Math.min(PANEL_MAX_WIDTH, viewportWidth - RAIL_WIDTH - PAGE_MIN_WIDTH);
}

export function clampPanelWidth(width: number, viewportWidth: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, maxPanelWidth(viewportWidth));
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(width)));
}

export function readPanelState(): PanelState {
  if (typeof document === "undefined") return { open: false, width: PANEL_DEFAULT_WIDTH };
  const m = document.cookie.match(/(?:^|; )trf-ai-panel=([^;]*)/);
  if (!m) return { open: false, width: PANEL_DEFAULT_WIDTH };
  const [open, width] = decodeURIComponent(m[1]).split(".");
  const w = Number(width);
  return {
    open: open === "1",
    width: Number.isFinite(w) && w >= PANEL_MIN_WIDTH && w <= PANEL_MAX_WIDTH ? w : PANEL_DEFAULT_WIDTH,
  };
}

export function writePanelState(s: PanelState): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE}=${s.open ? 1 : 0}.${Math.round(s.width)}${cookieAttrs()}`;
}
