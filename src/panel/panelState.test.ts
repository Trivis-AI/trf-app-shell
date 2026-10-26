// node --test src/panel/panelState.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PANEL_DEFAULT_WIDTH, parsePanelState } from "./panelCookie.ts";

test("no cookies: closed, default width, menu untouched", () => {
  assert.deepEqual(parsePanelState(""), { open: false, width: PANEL_DEFAULT_WIDTH, menuCollapsed: false });
});

test("open comes from the session cookie, not from the first field of the sizes cookie", () => {
  assert.equal(parsePanelState("trf-ai-panel=1.400.0").open, false, "a 0.46.0 host wrote open; ignored");
  assert.equal(parsePanelState("trf-ai-panel=0.400.0; trf-ai-panel-open=1").open, true);
  assert.equal(parsePanelState("trf-ai-panel-open=1").open, true, "sizes cookie absent");
  assert.equal(parsePanelState("trf-ai-panel-open=0").open, false);
  assert.equal(parsePanelState("trf-ai-panel-open-x=1").open, false, "another cookie with the same prefix");
});

test("width and menu flag come from the sizes cookie, out-of-range widths fall back", () => {
  assert.deepEqual(parsePanelState("trf-theme=dark; trf-ai-panel=0.480.1"), { open: false, width: 480, menuCollapsed: true });
  assert.equal(parsePanelState("trf-ai-panel=0.100.0").width, PANEL_DEFAULT_WIDTH);
  assert.equal(parsePanelState("trf-ai-panel=0.abc").width, PANEL_DEFAULT_WIDTH);
  assert.equal(parsePanelState("trf-ai-panel=1.400").menuCollapsed, false, "two-field cookie from before the menu flag");
});
