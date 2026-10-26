# trf-app-shell — agent notes

`@trf/app-shell` is the shared shell for the tenant-facing apps: sidebar, discovery-driven menu,
desktop breadcrumb bar, theme switch. It is a **library**, not an app. There is no `index.html`
and no entry stylesheet here; the consuming app owns the Tailwind and token wiring described in
`node_modules/@trf/ui2/docs/for-consuming-apps.md`.

Tom owns this repo's chrome and its release cadence. Check with him before changing anything in
`AppShellLayout.tsx` beyond an additive prop.

## Design system — @trf/ui2

Before writing any UI here:

1. Read `node_modules/@trf/ui2/docs/STRUCTURE.json`, the manifest. Load only the doc you need.
2. Must-read first: `node_modules/@trf/ui2/docs/13-ai-coding-guidelines.md`.
   This repo *implements* much of `17-app-layout-conventions.md`, so read that one too before
   touching navigation chrome.
3. Use components from `@trf/ui2`. Search the barrel first; never recreate Button, Input, Dialog,
   Select, Checkbox or Table.
4. Colours, radii and fonts come from tokens only (`03-design-tokens.md`). No raw Tailwind palette
   colours, no off-scale sizes.
5. Icons: Lucide only (`05-iconography.md`). Test light and dark.
6. Before committing, run the consumer check from a trf-ui2 checkout:
   `node ../trf-ui2/scripts/check-consumer.mjs .`

## Two things this repo owns for the whole suite

**The `.dark` class.** `AppShellLayout.tsx:728` toggles `dark` on `<html>`, and that is the only
thing that makes the design system's dark theme activate anywhere: `tokens.css` redefines its
values under `.dark`, and each app declares
`@custom-variant dark (&:where(.dark, .dark *))` so `dark:` utilities resolve against the same
class. An app that does not mount `AppShellLayout` has no theme toggle and is light-only by
default. frontsupport is the standing example, and its stylesheet was missing the variant line
too, which produced light tokens with dark-mode colours on top for anyone on a dark OS.

**Way-finding.** Since v0.29.0 the desktop breadcrumb bar is rendered here, which is why doc 17
§2 bans inline back links in pages: this repo provides the alternative. `ShellCrumb`,
`ShellBarActions` and `ShellBarMeta` are the seams pages use (plus `ShellBarUnpinned` and
`ShellBarHidden`, which let the bar scroll away or drop it for a page). If you remove or rename them,
every consuming app loses its page actions, so treat them as public API.

## Live changes (src/live)

The shell keeps one server-sent-events stream per tab to the discovery service
(`GET /v1/changes/stream` on services), which forwards the organisation's audit events as change
identities: service, entity type, entity id, action, and the writer's relation to this person
(self, agent, other). No values. `LiveChangesProvider` is mounted around `{children}` in
`AppShellLayout` with the renewing org token; pages call `useLiveChanges({ entityTypes, onChange })`
and refetch what they show, and announce their own writes with `markOwnWrite(entityType, id)`
before sending them so those refresh without the "changed elsewhere" glow. The glow itself is the
design system's (`ServerDataTable` `liveChange` prop, `useChangeHighlight`).

Behaviour to keep: `ready` and `resync` ask every registration to refetch once; a batch is at most
one delivery per 500 ms per registration; 45 s without a message (heartbeats come every 25 s)
reconnects; `expired` reconnects when the token hook delivers a new one; 401/403/404/503 retry once a
minute, other failures with a 1 s to 30 s backoff. The pure parts (SSE parser, own-write window,
coalescer, backoff) are in `src/live/core.ts` with node tests: `node --test src/live/core.test.ts`.

## The AI panel (src/panel)

frontai's `/app/:slug/panel` route in an iframe docked at the right of the shell, pushing the
page; the AI app itself and the login app get no panel. Plan and contracts:
`documentation/AI-SIDEPANEL-PLAN.md` (sections 3, 4 and track 2 of section 6). `protocol.ts` is
the wire shape both sides import (frontai through this package): marker, version, connection id
minted by the host on every iframe load, `init` and `ready` handshake, no credential on the
bridge. `AiPanel.tsx` holds the hook, the button (top bar, after the page's actions, ⌘J) and the
frame (width animates like the sidebar, iframe anchored right, drag handle with a shield, snap
closed under 280 px, big chat past the maximum). `panelState.ts` keeps width and the menu flag in
the apex cookie `trf-ai-panel` for a year, so every app shares them, and open in the session
cookie `trf-ai-panel-open`, which the host writes only while the panel reports a conversation in
this tab (the panel's `conversation` message): an idle panel stays across client-side routes
inside one app and is gone on the next full load. The panel URL comes from discovery
`base_urls["ai-ui"]` (services keys `base_urls` by service definition key, not by app id);
`VITE_AI_PANEL_URL` overrides it in local development. The host checks the panel's `ready`
against its own token's account and org ids and sends nothing to a panel that does not match.
After `ready`, and on every route change, the host posts `context`: the app id, the route without
the `/app/:slug` prefix and the entity the route names (`pageEntity.ts`, a per-app table of id
positions, UUID or number only), with a version that only grows; the panel's starter chips follow
it (`documentation/AI-PANEL-ACTIONS.md`). `PanelMenuFit` (inside the SidebarProvider) collapses the
left menu to its rail when the docked panel would push the page under 720 px, remembers that in
the cookie's third field (`open.width.menu`) and expands the menu again when the panel closes,
unless the person changed the menu by hand meanwhile; it reads the menu's real width from ui2
7.23.0's `useSidebar().width`, which is user-adjustable there. Tests: `node --test
src/panel/protocol.test.ts src/panel/pageEntity.test.ts`.

## Appearance and the first paint

`src/appearance.ts` owns light, dark, system and the palette: cookies `trf-theme`, `trf-palette`
and the `trf-palette-default-v1` marker on the apex, applied as `dark` and `theme-<palette>`
classes on `<html>`. Every app's `index.html` carries an inline `<head>` script that reads the
same cookies and sets the same classes before the first paint, so a cross-app load does not
flash light (`documentation/FRONTEND-MAP.md`, "Theme before the first paint"). If the cookie
names, values or classes change here, that snippet changes in every app too.

## Known drift

`trf-ui2-check` reports five raw `<button>` elements carrying their own classes in
`AppShellLayout.tsx` (lines 391, 432, 479, 582, 600). They are shell chrome rather than page
content, so replacing them with `Button` is a visual decision about the shell, not a mechanical
cleanup. Leave them until Tom decides.

The `@trf/ui2` devDependency pin is only for local typechecking; apps bring their own ui2
(the peer range is `*`). Since v0.39.0 the meta pill uses `bg-sunken`, a ui2 v7.11.0 token.
Tailwind drops an unknown utility silently, so an app on an older ui2 gets a pill with no
background: bump the ui2 and app-shell pins together.

## Working in parallel (adopted 2026-10-20)
Feature work happens in a task worktree, not in this primary checkout: `claude -w t<task>-<slug>` or
`../documentation/tools/wt.sh new <repo> <name>`. Land from the worktree: `git fetch origin && git rebase
origin/main && <build> && git push origin HEAD:main`, tag from there, prod via `git push origin
origin/main:trivis`. Never force-push main or trivis. Rules and setup: `../documentation/PARALLEL-WORK.md`.
