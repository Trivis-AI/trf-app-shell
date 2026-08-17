# Document titles

Status: implemented in the shell (v0.33.0), verified locally against staging
data. Tom signed off on the `AppShellLayout.tsx` change. The consumer-side
`index.html` pass and the rollout are still outstanding.

## The problem

Every app ships a static `<title>` in its own `index.html` and nothing ever
updates it:

| app | current title |
|---|---|
| frontinvoices | `TRF Invoices` |
| frontledger | `TRF Ledger` |
| frontpayments | `TRF Payments` |
| … | `TRF <App>` |
| frontlogin | `Login` |
| frontsupport | `Trivis Support` |

Three consequences:

1. **Bookmarks are useless.** A bookmark of an invoice, of the invoice list, and
   of the same list in a different org all read `TRF Invoices`. Accountants work
   across many client orgs on the same handful of screens, so the org is the
   single most distinguishing fact and it appears nowhere.
2. **Tabs are indistinguishable.** Same string for every route in an app.
3. **"TRF" is an internal codename** and it is currently the most-seen piece of
   user-facing copy in the product. The customer-facing name is Trivis.

The only runtime writer today is `useStagingTitle` (`src/environment.ts:31`),
which prefixes `[STAGING] ` and re-applies it through a `MutationObserver`
because it assumed some other code might rewrite the title. Nothing ever does.

## Target format

```
<org> · <menu path> · Trivis AI Accounting
```

Org first: it is what differs between two tabs a user actually confuses, and
browsers truncate the *end* of a title, so the leading segment is what survives
in a tab strip and a bookmark bar.

| where | title |
|---|---|
| invoice list | `Acme OÜ · Sales › Invoices · Trivis AI Accounting` |
| one invoice | `Acme OÜ · Sales › Invoices › PI-2024-0042 · Trivis AI Accounting` |
| contacts | `Acme OÜ · CRM › Contacts · Trivis AI Accounting` |
| bank statements | `Acme OÜ · Payments › Bank Statements · Trivis AI Accounting` |
| org picker (frontlogin) | `Trivis AI Accounting` |
| any of the above on staging | `[STAGING] Acme OÜ · Sales › Invoices · …` |

Separators: `·` between segments, `›` inside the menu path (the same character
the sidebar search trail already uses). No em-dashes.

The menu path is localized, because it is built from the same `label()` that
resolves `labels[lang]`. `Trivis AI Accounting` stays as-is in every locale; it
is a brand, not a string to translate.

## Where the data already is

All of it is already resolved inside `AppShellLayout`, which is why this is one
library change and not fifteen app changes:

| piece | source |
|---|---|
| org name | `orgName`, `AppShellLayout.tsx:738` — org-token JWT claim `o.n`, falling back to the org list |
| menu path | the walk at `:940` already computes an ancestor `trail`; `activeSectionLeaf` (`:902`) already finds the active leaf |
| tail crumb | `useShellCrumbs()` |
| locale | `label()` / `lang` |
| staging | `isStagingHost()` |

The discovery menu is a genuine two-level tree, so `Sales › Invoices` is exactly
group label + leaf label — see `services/internal/service/service.go:1122` (group
`invoices-home`, label `Sales`) and `:1125` (leaf `invoices-list`, label
`Invoices`).

## Implementation

### 1. New file `src/title.ts`

Pure builder plus a hook, mirroring how `favicon.ts` and `environment.ts` are
structured (own file, one exported hook, no changes to the layout's own logic):

```ts
const PRODUCT = "Trivis AI Accounting";

export function buildDocumentTitle({ orgName, path }: {
  orgName: string | null;
  path: string[];          // ["Sales", "Invoices", "PI-2024-0042"]
}): string {
  const segments = [orgName, path.join(" › ") || null, PRODUCT].filter(Boolean);
  return (isStagingHost() ? "[STAGING] " : "") + segments.join(" · ");
}

export function useDocumentTitle(parts): void   // writes document.title in an effect
```

Folding the staging prefix in here makes this the single writer of
`document.title`, which lets `useStagingTitle` and its `MutationObserver` be
deleted. `useStagingTitle` is internal (not exported from `src/index.ts`), so
removing it breaks no consumer.

### 2. Ancestor trail in `AppShellLayout.tsx`

`activeSectionLeaf` returns only the leaf. Add a sibling that returns the
ancestor chain, using the same recursion — additive, existing callers untouched:

```ts
const activeSectionPath = (nodes: MenuItem[]): MenuItem[] | null
```

Three normalizations, so the title agrees with what the sidebar shows and stays
short enough to survive truncation:

- **Single-child groups collapse.** `renderNode` (`:1031`) already renders a
  group holding one leaf as a single row with the group's label. The title must
  apply the same rule, or the sidebar says `Products` while the tab says
  `Products › Product Catalog`.
- **Consecutive duplicate labels collapse.** `Contracts › Contracts` otherwise
  (`service.go:1169` and `:1172` share a label).
- **Deeper than two levels trims to outermost group + leaf.** Found in live
  testing, not in review: Settings is three levels, so a page under it produced

  ```
  CoffeeNet OÜ · Settings › Sales & Invoicing › Invoice settings › New Invoice Property · Trivis AI Accounting
  ```

  at 107 characters, burying the page's own name far past any truncation point —
  the exact failure the title exists to fix. Trimming the middle gives
  `Settings › Invoice settings › New Invoice Property` at 88, and matches the
  two-level shape the rest of the menu already has.

### 3. Write the title from inside the crumbs provider

This is the one structural catch. `AppShellLayout`'s body *renders*
`ShellCrumbsProvider` (`:1137`), so a `useShellCrumbs()` call in that body sits
outside its own provider and would always see `[]`. The title therefore has to
be written from a null-rendering child:

```tsx
<ShellCrumbsProvider>
  <DocumentTitle orgName={orgName} section={sectionPathLabels} />
  <AppShell …>
```

`DocumentTitle` calls `useShellCrumbs()` itself and appends the tail. Net change
to `AppShellLayout.tsx`: one import, one helper function, one element, and the
removal of the `useStagingTitle()` call.

### 4. Static `index.html` in all 15 apps

Set every one to `<title>Trivis AI Accounting</title>`. This is what shows for
the frame before React mounts, and what a bookmark captures if made during load.
It removes `TRF` from user-facing copy even on the apps that never mount the
shell.

### 5. frontsupport

It deliberately does not use `AppShellLayout` (`SupportLayout.tsx:16`), so it
gets nothing from the shell. Its `Trivis Support` title is not wrong; step 4
alone would arguably make it worse. Leave it, or give it a two-line local
`document.title` write. Decide separately; it is not a blocker.

## Verified

Against staging data, with the working tree symlinked into `frontinvoices`:

| case | result |
|---|---|
| list route | `CoffeeNet OÜ · Sales › Invoices · Trivis AI Accounting` |
| client-side nav (no reload) | retitles to `… · Sales › Series · …` |
| page publishing a `ShellCrumb` | `… · Settings › Invoice settings › New Invoice Property · …` |
| second org, same screen | `Elisa Eesti AS · Sales › Invoices · …` |
| truncated to a tab strip's width | `Elisa Eesti AS · Sal…` — the org leads, which is the point |

## Degradation

| situation | title | then |
|---|---|---|
| org token still minting | `Sales › Invoices · Trivis AI Accounting` | org appears when the mint lands |
| discovery menu not loaded | `Acme OÜ · Invoices · Trivis AI Accounting` (falls back to the `appLabel` prop) | refines when the menu arrives |
| route not in the menu | same `appLabel` fallback | stays |
| page publishes no `ShellCrumb` | section-level title | fine; only 3 apps publish tails today |

Seeding the path from `appLabel` when the menu is absent is what keeps the title
from flashing `Trivis AI Accounting` alone on every cold load.

## Tail-crumb coverage

Detail-page titles only get the record id where the page already publishes a
`ShellCrumb`. Today: `frontinvoices` (3 files), `frontpayments` (9),
`frontpurchase` (5). The other 11 apps degrade to the section title and improve
for free as pages adopt `ShellCrumb` — no title-specific work needed in any app.

## Rollout

One library change, then the usual fan-out. All 14 consumers are currently
pinned uniformly at `github:Trivis-AI/trf-app-shell#v0.32.0`, so nothing is
straggling.

1. Implement in `trf-app-shell`; `npm run typecheck` and
   `node ../trf-ui2/scripts/check-consumer.mjs .`
2. Tag `v0.33.0`, push.
3. Bump the pin in 14 repos (`/rollout exec`). `@trf/app-shell` is a github-tag
   dep, so it needs the same treatment as `@trf/ui2`:
   `rm -rf node_modules/@trf/app-shell node_modules/.vite`, then verify the
   lockfile SHA actually moved.
4. `index.html` title in the same commit per app (step 4 above).
5. Ship to staging, verify on `*.trf.is`, get sign-off, then promote to `trivis`.

Verification on staging: open two orgs in two tabs on the same screen and
confirm the tab strip distinguishes them; bookmark an invoice and confirm the
bookmark bar entry leads with the org; confirm the `[STAGING]` prefix survives
client-side navigation (it is now written by the title builder rather than
restored by an observer).
