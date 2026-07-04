# Spec: Unify all settings under a single Settings menu (3-level)

Status: proposed · Owner: Jaak · Date: 2026-06-18

## Goal

Consolidate every settings-like screen under one top-level **Settings** section,
organised into a **3-level** tree (Settings → category → setting page). Today
settings are split between a central `Settings` section and several per-app
"Settings" entries buried inside their app sections.

## Where the change actually lives

The menu is **hardcoded Go** in the discovery service, not DB/JSON config:

- **Repo:** `Trivis-AI/trfservices`
- **File:** `internal/service/service.go`
- **Func:** `defaultMenusForPackage(packageKey string) model.RoleMenus` (~line 1100)

Menu nodes are `model.MenuNode` with `Path` + `ServiceKey` + `AppKey` (NOT full
URLs). The frontend host is resolved per-request by `resolveMenuUrls()` from the
org's service endpoints, then post-processed by `applyLocalhostOverride` /
`applyDomainOverride` (`internal/api/discovery.go`). So a moved node keeps its
`ServiceKey`/`Path` and still resolves to the right app host.

`trf-app-shell` needs **no rendering change** — depth-3 already renders recursively
(`renderNode`, `src/AppShellLayout.tsx:806`), search flattens to any depth with a
breadcrumb trail, and the top-level `Settings` keeps its gear icon. One optional
app-shell cleanup is in §5.

### Three role trees

`defaultMenusForPackage` returns `model.RoleMenus{Owner, Audit, Member}`:

- **Owner** (`defaultMenu`, ~line 1102) — the full tree; this is what the live
  `/v1/discovery/menu` returns for an owner. **Primary target of this change.**
- **Audit** (`auditMenu`, ~line 1250) — `copyMenu(defaultMenu)` plus a `portal-settings`
  node. **Auto-inherits** the new Settings structure; no edit needed.
- **Member** (`memberMenu`, ~line 1263) — a *separate, smaller* literal. It is
  **already partially unified** (flat `member-settings-home`, ~line 1360, pulling in
  Invoice/Purchase/Payment settings) but inconsistent, and still leaves
  `products-settings` under Products. Must be edited separately (§3).

## Decisions locked in

1. **Move-only** — moved per-app settings leave their app section and live only under
   Settings; search surfaces them from anywhere.
2. **`Organizations` (`portal-home`) stays top-level.** The redundant "Organisation
   settings" link in the app-shell org dropdown is retired (§5).

## Decision needed

3. **Member tree depth.** Align the Member Settings section to the same 3-level
   structure (recommended, for consistency), or leave Member's simpler flat list?
   This spec assumes **align**.

---

## 1. Target Settings IA (Owner)

```
Settings (order 110, gear icon)
├─ Organisation              (order 10)
│   ├─ Organisation profile  settings-ui  /app/organization
│   ├─ Employees             settings-ui  /app/employees
│   ├─ Locations             settings-ui  /app/locations
│   │   └─ Location Types    settings-ui  /app/location-types
│   └─ Projects              settings-ui  /app/projects
│       └─ Project Types     settings-ui  /app/project-types
├─ Banking & Payments        (order 20)
│   ├─ Banks                 settings-ui  /app/banks
│   │   └─ Bank Types        settings-ui  /app/bank-types
│   └─ Payments settings     payments-ui  /app/settings        [moved]
├─ Sales & Invoicing         (order 30)
│   ├─ Invoice settings      invoices-ui  /app/settings        [moved]
│   └─ E-Invoice             settings-ui  /app/e-invoice
├─ Purchases                 (order 40)
│   └─ Purchase settings     purchase-ui  /app/settings        [moved]
├─ Products                  (order 50)
│   └─ Product settings      products-ui  /app/settings        [moved]
├─ Contracts                 (order 60)
│   └─ Contract settings     contracts-ui /app/settings        [moved]
├─ AI                        (order 70)
│   └─ AI settings           ai-ui        /app/settings        [moved]
└─ Developer                 (order 80)
    ├─ API Keys              settings-ui  /app/api-keys
    └─ MCP Keys              settings-ui  /app/mcp-keys
```

Notes:
- Moved nodes keep their existing IDs (`invoices-settings`, `purchase-settings`,
  `payments-settings`, `products-settings`, `contracts-settings`, `ai-settings`) so
  no bookmarks/telemetry keyed on id break. Only new group IDs (`settings-grp-*`)
  are added.
- Sub-group nodes carry **no** `ServiceKey`/`AppKey`/`Path` (they're pure containers;
  compare `invoicing-home` / `member-settings-home` which already do this).
- The central "Organisation" leaf is relabelled **Organisation profile** so it
  doesn't read identically to its parent group; bare-"Settings" leaves are
  relabelled in-context (Purchase settings, Payments settings, …).
- Node IDs must stay globally unique in the tree (app-shell uses them for
  open-group state). Moving (not duplicating) preserves uniqueness.

---

## 2. Owner tree edits (`defaultMenu`)

### 2a. Replace the `settings-home` node (~line 1214–1230) with:

```go
{
    Id: "settings-home", Label: "Settings", Labels: map[string]string{"en": "Settings", "ee": "Seaded"},
    ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 110,
    Items: []model.MenuNode{
        {
            Id: "settings-grp-organisation", Label: "Organisation", Labels: map[string]string{"en": "Organisation", "ee": "Organisatsioon"},
            Enabled: true, Order: 10,
            Items: []model.MenuNode{
                {Id: "settings-organization", Label: "Organisation profile", Labels: map[string]string{"en": "Organisation profile", "ee": "Organisatsiooni profiil"}, Path: "/app/organization", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 10},
                {Id: "settings-employees", Label: "Employees", Labels: map[string]string{"en": "Employees", "ee": "Töötajad"}, Path: "/app/employees", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 20},
                {Id: "settings-locations", Label: "Locations", Labels: map[string]string{"en": "Locations", "ee": "Asukohad"}, Path: "/app/locations", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 30,
                    Items: []model.MenuNode{
                        {Id: "settings-location-types", Label: "Location Types", Labels: map[string]string{"en": "Location Types", "ee": "Asukohatüübid"}, Path: "/app/location-types", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 10},
                    },
                },
                {Id: "settings-projects", Label: "Projects", Labels: map[string]string{"en": "Projects", "ee": "Projektid"}, Path: "/app/projects", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 40,
                    Items: []model.MenuNode{
                        {Id: "settings-project-types", Label: "Project Types", Labels: map[string]string{"en": "Project Types", "ee": "Projekttüübid"}, Path: "/app/project-types", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 10},
                    },
                },
            },
        },
        {
            Id: "settings-grp-banking", Label: "Banking & Payments", Labels: map[string]string{"en": "Banking & Payments", "ee": "Pangandus ja maksed"},
            Enabled: true, Order: 20,
            Items: []model.MenuNode{
                {Id: "settings-banks", Label: "Banks", Labels: map[string]string{"en": "Banks", "ee": "Pangad"}, Path: "/app/banks", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 10,
                    Items: []model.MenuNode{
                        {Id: "settings-bank-types", Label: "Bank Types", Labels: map[string]string{"en": "Bank Types", "ee": "Pangatüübid"}, Path: "/app/bank-types", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 10},
                    },
                },
                {Id: "payments-settings", Label: "Payments settings", Labels: map[string]string{"en": "Payments settings", "ee": "Maksete seaded"}, Path: "/app/settings", ServiceKey: "payments-ui", AppKey: "payments", Enabled: true, Order: 20},
            },
        },
        {
            Id: "settings-grp-sales", Label: "Sales & Invoicing", Labels: map[string]string{"en": "Sales & Invoicing", "ee": "Müük ja arved"},
            Enabled: true, Order: 30,
            Items: []model.MenuNode{
                {Id: "invoices-settings", Label: "Invoice settings", Labels: map[string]string{"en": "Invoice settings", "ee": "Arve seaded"}, Path: "/app/settings", ServiceKey: "invoices-ui", AppKey: "invoices", Enabled: true, Order: 10},
                {Id: "settings-einvoice", Label: "E-Invoice", Labels: map[string]string{"en": "E-Invoice", "ee": "E-arve"}, Path: "/app/e-invoice", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 20},
            },
        },
        {
            Id: "settings-grp-purchases", Label: "Purchases", Labels: map[string]string{"en": "Purchases", "ee": "Ost"},
            Enabled: true, Order: 40,
            Items: []model.MenuNode{
                {Id: "purchase-settings", Label: "Purchase settings", Labels: map[string]string{"en": "Purchase settings", "ee": "Ostu seaded"}, Path: "/app/settings", ServiceKey: "purchase-ui", AppKey: "purchase", Enabled: true, Order: 10},
            },
        },
        {
            Id: "settings-grp-products", Label: "Products", Labels: map[string]string{"en": "Products", "ee": "Tooted"},
            Enabled: true, Order: 50,
            Items: []model.MenuNode{
                {Id: "products-settings", Label: "Product settings", Labels: map[string]string{"en": "Product settings", "ee": "Toodete seaded"}, Path: "/app/settings", ServiceKey: "products-ui", AppKey: "products", Enabled: true, Order: 10},
            },
        },
        {
            Id: "settings-grp-contracts", Label: "Contracts", Labels: map[string]string{"en": "Contracts", "ee": "Lepingud"},
            Enabled: true, Order: 60,
            Items: []model.MenuNode{
                {Id: "contracts-settings", Label: "Contract settings", Labels: map[string]string{"en": "Contract settings", "ee": "Lepingu seaded"}, Path: "/app/settings", ServiceKey: "contracts-ui", AppKey: "contracts", Enabled: true, Order: 10},
            },
        },
        {
            Id: "settings-grp-ai", Label: "AI", Labels: map[string]string{"en": "AI", "ee": "AI"},
            Enabled: true, Order: 70,
            Items: []model.MenuNode{
                {Id: "ai-settings", Label: "AI settings", Labels: map[string]string{"en": "AI settings", "ee": "AI seaded"}, Path: "/app/settings", ServiceKey: "ai-ui", AppKey: "ai", Enabled: true, Order: 10},
            },
        },
        {
            Id: "settings-grp-developer", Label: "Developer", Labels: map[string]string{"en": "Developer", "ee": "Arendaja"},
            Enabled: true, Order: 80,
            Items: []model.MenuNode{
                {Id: "settings-api-keys", Label: "API Keys", Labels: map[string]string{"en": "API Keys", "ee": "API võtmed"}, Path: "/app/api-keys", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 10},
                {Id: "settings-mcp-keys", Label: "MCP Keys", Labels: map[string]string{"en": "MCP Keys", "ee": "MCP võtmed"}, Path: "/app/mcp-keys", ServiceKey: "settings-ui", AppKey: "settings", Enabled: true, Order: 20},
            },
        },
    },
},
```

### 2b. Remove the moved leaves from their app sections (Owner)

Delete these child entries (move-only):

| Remove `Id` | From node (line) |
|---|---|
| `ai-settings` | `ai-home` (1109) |
| `invoices-settings` | `invoices-home` (1118) |
| `payments-settings` | `payments-home` (1138) |
| `products-settings` | `products-home` (1146) |
| `contracts-settings` | `contracts-home` (1155) |
| `purchase-settings` | `purchase-home` (1178) |

> `> ee` strings on new group labels / relabelled leaves need a native-speaker pass.

---

## 3. Member tree edits (`memberMenu`) — assumes decision #3 = align

Restructure `member-settings-home` (~line 1360) to mirror §2a, reusing the member
IDs already present (`member-settings-organisation`, `-banks`, `-employees`,
`-locations`, `-projects`, `-api-keys`, `-mcp-keys`, `-einvoice`) and the existing
moved-in leaves (`settings-invoice`, `settings-purchase`, `settings-payments`).
Then **remove `products-settings` from member `products-home`** (~line 1304) and add
a `settings-products` leaf under the member Products group. Member intentionally
omits AI settings, so the AI sub-group is dropped from the member Settings tree
(confirm with product). Group structure otherwise matches Owner.

---

## 4. Rollout (automatic)

`Migrate()` (`service.go:51`) calls `seed()`, which:

1. Re-`UpsertPackageTemplateMenu` for every role from `defaultMenusForPackage` (~line 283).
2. `DeleteAllAccountOrganizationMenus` (~line 302) — wipes cached per-account menus.

So on the next request after deploy, every user re-seeds from the new template
(`GetDiscoveryForUser`, ~line 678). **No manual ConfigVersion bump needed.**

⚠️ This wipes any per-account menu customizations made via `PUT /discovery/menu` —
but that is already the behavior of every deploy that runs `seed()`, so it is not a
new risk introduced here. Confirm no org relies on saved custom menus before ship.

---

## 5. trf-app-shell — org dropdown cleanup (optional, small)

The org dropdown has a hardcoded **"Organisation settings"** item
(`src/AppShellLayout.tsx:319-322`) → `orgSettingsUrl` (`…/manage-organization/list`,
`src/AppShellLayout.tsx:556`), which duplicates `Organizations → Overview`. Per
decision #2, **remove that `DropdownMenuItem`** (and `orgSettingsUrl` if unused).

No other app-shell change — depth-3 rendering, search flattening, and the top-level
`Settings` gear icon already work.

---

## 6. Validation & acceptance

- `go build ./...` + `go test ./...` in `trfservices`.
- Re-fetch the live menu for an **owner** and a **member** and assert depth + unique IDs:
  ```
  curl -s -H "authorization: Bearer <jwt>" https://services-api.trivis.ee/v1/discovery/menu \
    | jq '[.. | objects | select(has("id")) | .id] | {ids: length, unique: (unique|length)}'  # equal
  ```
- Visual check in app: 3-level indent reads cleanly; active branch auto-expands;
  ⌘K shows `Settings › Organisation › Locations` trail for "Location Types".

Acceptance:
- [ ] All six scattered settings appear only under `Settings` (Owner + Audit + Member).
- [ ] `Settings` renders 3 levels; entity/type pairs nest correctly.
- [ ] No non-Settings section lists a "Settings" leaf.
- [ ] Existing leaf IDs unchanged; only `settings-grp-*` group IDs added.
- [ ] All IDs unique; every leaf resolves to a working URL.
- [ ] Org dropdown no longer shows a redundant "Organisation settings" link.
- [ ] `portal-home` (Organizations) unchanged.
```
