// What the AI panel remembers between page loads. Moving between apps is a full page
// load on another origin, so the state sits in cookies on the apex domain, like the
// theme (appearance.ts), and every app reads the same values. Sizes are the plan's
// section 3.2 numbers; the comments there say which ones are still to tune on screen.
// The cookie names, the sizes and the parser are in panelCookie.ts (pure, node-tested);
// this file is the document side.

import { cookieAttrs } from "../appearance";
import { OPEN_COOKIE, PANEL_DEFAULT_WIDTH, parsePanelState, SIZES_COOKIE, type PanelState } from "./panelCookie";

export {
  EXPAND_OVERSHOOT,
  PAGE_MIN_WIDTH,
  PANEL_DEFAULT_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  RAIL_WIDTH,
  SNAP_CLOSE_WIDTH,
  clampPanelWidth,
  maxPanelWidth,
  parsePanelState,
  type PanelState,
} from "./panelCookie";

export function readPanelState(): PanelState {
  if (typeof document === "undefined") return { open: false, width: PANEL_DEFAULT_WIDTH, menuCollapsed: false };
  return parsePanelState(document.cookie);
}

/** Open goes in the session cookie; the sizes cookie keeps the same value in its first field for 0.46.0 hosts. */
export function writePanelState(s: PanelState): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIZES_COOKIE}=${s.open ? 1 : 0}.${Math.round(s.width)}.${s.menuCollapsed ? 1 : 0}${cookieAttrs()}`;
  document.cookie = `${OPEN_COOKIE}=${s.open ? 1 : 0}${cookieAttrs(s.open ? "session" : "expire")}`;
}
