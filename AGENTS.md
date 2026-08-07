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
`ShellBarActions` and `ShellBarMeta` are the seams pages use. If you remove or rename them,
every consuming app loses its page actions, so treat them as public API.

## Known drift

`trf-ui2-check` reports five raw `<button>` elements carrying their own classes in
`AppShellLayout.tsx` (lines 351, 392, 436, 492, 510). They are shell chrome rather than page
content, so replacing them with `Button` is a visual decision about the shell, not a mechanical
cleanup. Leave them until Tom decides.

This repo also pins `@trf/ui2` at v7.0.13 while the apps are on v7.0.45 or later. Worth a
deliberate bump rather than a drive-by one, since the shell's chrome is the most visible surface
in the suite.
