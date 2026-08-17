export { AppShellLayout } from "./AppShellLayout";
export { useThemeFavicon } from "./favicon";
// For pages that do not mount the shell and so get no title from it — the login
// portal's public pages are the standing case, exactly as they already reach for
// useThemeFavicon. Keeps one implementation of the format and the staging mark.
export { useDocumentTitle, buildDocumentTitle } from "./title";
export type { DocumentTitleParts } from "./title";
export { useOrgLanding, rememberOrg, readLastOrg, readLastApp } from "./orgLanding";
export type { OrgLandingStatus, OrgLandingOptions } from "./orgLanding";
export { ShellCrumb, ShellCrumbsProvider, useShellCrumbs, ShellBarActions, ShellBarMeta } from "./crumbs";
export type { AppShellLayoutProps, ItemAction, TranslationLike } from "./AppShellLayout";
export type { ShellCrumbEntry } from "./crumbs";
