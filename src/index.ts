export { AppShellLayout } from "./AppShellLayout";
export { useThemeFavicon } from "./favicon";
// For pages that do not mount the shell and so get no title from it — the login
// portal's public pages are the standing case, exactly as they already reach for
// useThemeFavicon. Keeps one implementation of the format and the staging mark.
export { useDocumentTitle, buildDocumentTitle } from "./title";
export type { DocumentTitleParts } from "./title";
export { useOrgLanding, rememberOrg, readLastOrg, readLastApp } from "./orgLanding";
export type { OrgLandingStatus, OrgLandingOptions } from "./orgLanding";
export { ShellCrumb, ShellCrumbsProvider, useShellCrumbs, ShellBarActions, ShellBarMeta, ShellBarUnpinned, ShellBarHidden } from "./crumbs";
export type { AppShellLayoutProps, ItemAction, TranslationLike } from "./AppShellLayout";
export type { ShellCrumbEntry } from "./crumbs";
export { PALETTE_OPTIONS, COLOR_MODES, usePalette, useColorMode } from "./appearance";
// Live changes: one stream per tab from the discovery service; pages register
// what they show and refetch when it changed elsewhere. See src/live.
export { LiveChangesProvider, useLiveChanges, useLiveChangesStatus, markOwnWrite, servicesApiBase } from "./live/liveChanges";
export type { LiveStatus, UseLiveChangesOptions, LiveChangesProviderProps, LiveChangeBatch, LiveChangeEvent, LiveRefreshReason, LiveActor } from "./live/liveChanges";
export type { ColorMode } from "./appearance";
// The AI panel's bridge protocol, shared with frontai (the panel side). See src/panel.
export {
  AI_BRIDGE_MARKER, AI_BRIDGE_VERSION, envelope, parseHostMessage, parsePanelMessage,
  identityFromToken, embeddingOrigin, aiPanelPath,
} from "./panel/protocol";
export type { AiHostMessage, AiPanelMessage, AiTheme, AiColorMode, AiIdentity, AiPageContext, AiPageEntity } from "./panel/protocol";
export type { AiPanelStatus } from "./panel/AiPanel";
// Which entity a route names, for the panel's `context` message (documentation/AI-PANEL-ACTIONS.md).
export { pagePath, pageEntityFromPath } from "./panel/pageEntity";
