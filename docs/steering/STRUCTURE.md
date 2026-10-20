# Night Shift Codebase Structure

> The rules for where code lives. Read this before you add a file, a folder or a package.
> Refine it when a rule changes. Record the change in the ADR table of `TECH.md`.

Last updated: 2026-10-21

Night Shift is a **layered vertical codebase**.

- **Layered:** packages sit in layers. A package imports only from packages in a lower layer.
- **Vertical:** inside a package, code is grouped by what it does (a domain), not by what it is (a kind).

Code that changes together lives together. A boundary that is not enforced is not a boundary.

## 1. Layers

| Layer | Packages | May import (`@nightshift/*`) |
| --- | --- | --- |
| 0. Foundation | `config`, `db`, `flows`, `ui` | Nothing. `ui` imports only itself. |
| 1. Capabilities | `auth`, `agents` | `auth`: `db`. `agents`: `flows`. |
| 2. Core | `engine` | `db`, `flows`, `agents`, `auth` |
| 3. Core domains | `devices` (planned) | Layer 2 and lower |
| 4. Surface | `api` | Layer 3 and lower |
| 5. Runtime | `daemon` (planned) | Layer 4 and lower |
| 6. Apps | `server`, `desktop`, `web` | See below |

The apps:

- `apps/server` imports the runtime and lower layers. It holds the dev entry and the CLI.
- `apps/desktop` imports only the runtime (`@nightshift/daemon`) and `@nightshift/db/data-dir`.
- `apps/web` imports only `@nightshift/api/client` (types only, `import type`), `@nightshift/flows` (the browser-safe root, never `./files`) and `@nightshift/ui`. It never imports `engine`, `agents`, `auth` or `db`.

Rules:

- Dependencies point down. A lower layer never knows a higher one.
- No package imports another app. An app is never a dependency.
- No cycles between packages. No cycles between the verticals of one package.
- When a lower layer must call a higher one, the lower layer declares a port (an interface). The higher layer implements it, and the composition root wires it.

## 2. What each package owns

One package is one bounded context. One domain has one home.

| Package | Owns | Does not own |
| --- | --- | --- |
| `db` | The libsql client, the drizzle schema, migrations, the data directory. | Queries of a domain. Those live with the domain. |
| `flows` | The flow document: schema, validation, migration, templates, rules, and the pure edits of a draft (`draft/`: new nodes, graph and outcome edits, renames, the draft check). The `.nightshift/` file loader (`./files`, the only I/O). Schedules and agent profiles, because a flow document references them. | Running a flow. UI copy: the editor passes its own words to `checkDraft`. |
| `ui` | shadcn/ui components and tokens. See `AGENTS.md`. | Anything domain-specific. |
| `auth` | Identity and access on Better Auth: login, two-factor, pairing, device keys, Spaces, members, roles. The auth tables. | Device rows. |
| `agents` | Harness sessions, one harness adapter per harness, decider providers, MCP and CLI tools, pricing, skills. | Run order, retries, gates. |
| `engine` | The run engine: compile a flow to a graph, walk it, run policy, gates, the event log, the run read model, projects and worktrees, the device-config document. | Peers, sync and offers (moving to `devices`). Process concerns such as the lease and OS dialogs (moving to `daemon`). |
| `devices` (planned) | Peers, hosts, the exchange, offers, placement, work relay. Today this domain is split over `engine/device`, `engine/exchange`, `apps/server/src/devices` and `api/context.ts`. | The execution port (`Device`). That stays in `engine`. |
| `api` | The oRPC surface: procedures per domain, middleware, the router type the web app consumes. Every procedure declares an input schema, an output schema and a one-line summary. That makes the router the one source for the web client, OpenAPI and any agent tool surface (MCP). | Domain logic. A procedure validates, checks access and calls one domain function. |
| `daemon` (planned) | Boot and runtime: `startDaemon()`, the Hono app, the lease, health, document sync transport, signals, hot-reload handover. | Domain logic. |
| `apps/server` | The dev entry (`bun --hot`) and the CLI (`cli/`). | Domain logic. |
| `apps/desktop` | Tray, window, updates, watchdog. | Any logic of the daemon. |
| `apps/web` | The UI. One vertical per product area. | Rules that the engine or `flows` already has. |

### Tables have owners

Each table has one owning package. The schema file names the owner above each table group. Another package reads or writes that table only through the owner's functions. Example: the engine asks `@nightshift/auth` for the members of a Space. It does not query `member`.

### Ports for external I/O

Every call to `git`, `gh`, a harness CLI, `osascript` or another OS program goes through a port. The port is an interface in the package that needs it. The adapter implements it. Tests use a fake adapter.

## 3. Public surfaces

Each package lists its public entry points in `package.json` `exports`.

- **No wildcard exports** (`"./*"`). Every entry point is named on purpose.
- Exception: `@nightshift/ui` keeps `./components/*`, `./hooks/*` and `./lib/*`. That is the shadcn layout, and `components.json` depends on it.
- `index.ts` exports what consumers use. It is not a barrel of every file.
- Test helpers, fakes and fixtures are public only through `./testing`. Production code never imports `./testing`.
- An entry for the web app is type-only and browser-safe (`@nightshift/api/client`).
- A type that the emitted declaration of another package names must be on an entry. Example: the API router type names engine and auth view types, so their roots export them. Without this, `tsc` fails with TS2883.

The entries today:

| Package | Entries |
| --- | --- |
| `agents` | `.`, `./harness-facts`, `./mcp`, `./pricing`, `./types`, `./testing` (fakes, `fixturePath(name)`). The engine uses the four light entries: the root loads every harness. `./harness-facts` is browser-safe. |
| `api` | `.` (`appRouter` and its types), `./client` (types only, for `apps/web`), `./context` |
| `auth` | `.`, `./testing` |
| `db` | `.`, `./schema`, `./data-dir`, `./migrate` |
| `engine` | `.`, `./lease` (light, for the health check, until phase 4 moves the lease to the daemon), `./testing` |
| `flows` | `.`, `./files` |
| `ui` | `./components/*`, `./hooks/*`, `./lib/*`, `./globals.css`, `./postcss.config` |
| `apps/server` | `.`, `./daemon-env`, `./health`, `./serve`, `./services`, `./shims/*` by name. A stopgap for `apps/desktop` until phase 4. |
- A consumer imports a package by its name and a listed entry. Never by a relative path into another package (`../../packages/agents/src/...`).

## 4. Verticals

Every app and every package (except `ui` and `config`) is cut into verticals. The model is the one yapyap uses.

### What a vertical is

- A vertical is a folder named with a domain word from `docs/glossary.md`: `runs/`, `gates/`, `schedules/`, `projects/`.
- Its `index.ts` is a barrel. The barrel is the **only** public surface of the vertical.
- Code outside the vertical imports from the barrel only. A deep import into another vertical (`features/runs/components/run-list`) is an error.
- Inside the vertical, code uses relative imports and may reach any file.
- A vertical holds everything about its domain: components, hooks, query options, types, utilities, constants and tests.
- Inside a vertical, kind folders are allowed when the vertical is big enough: `components/`, `hooks/`, `lib/`, `queries/`, `mutations/`. A small vertical stays flat.
- Every name on a barrel has an importer outside the vertical. A name nobody imports comes off the barrel.

### Where verticals live

| Workspace | Verticals in | Also at the top of `src/` |
| --- | --- | --- |
| An app (`apps/web`, `apps/server`, `apps/desktop`) | `src/features/<vertical>/` | `routes/` (web), `shared/`, the entry and composition root files |
| A package (`engine`, `agents`, `flows`, `api`, `auth`, `db`, `daemon`, `devices`) | `src/<vertical>/` | `index.ts` (composes the vertical barrels into the package API), `testing/` |

- **`shared/` (apps only)** holds cross-cutting code that is not a product area: the API client, logging, the page shell, time formatting. Each piece in `shared/` is a named folder with its own barrel (`shared/api/`, `shared/time/`). No loose files in `shared/`.
- **No kind buckets at the top of `src/`.** Do not create `src/lib/`, `src/utils/`, `src/helpers/`, `src/hooks/`, `src/components/`, `src/types/`, `src/common/` or `src/misc/`. Exception: `packages/ui` (the shadcn layout).
- No catch-all `types.ts` for a whole package. Types live in the vertical that owns them.

### Exceptions are listed, not implied

Two exceptions exist, as in yapyap. Each one is listed by name in `scripts/check-verticals.ts` with a comment that says why.

- **Leaf contract:** a pure-data file (no imports of its own) that a vertical exposes past its barrel, because importing the barrel would close a module-init cycle. Its symbols are also on the barrel.
- **Peer port:** two verticals that depend on each other cross only through one named port file per direction. Every other deep import between them stays banned. Often only one direction closes the cycle. Then only that direction has a port, and the other direction imports the barrel.

### Growth

- Start a new concept inside the vertical that uses it. Promote it to its own vertical when a second vertical needs it.
- A new package is right only when a vertical must sit in a different layer than its host, or when two apps need it.

### Size limits

These are signals, not hard limits. A file past the limit needs a reason in its header comment.

- A file over 600 lines: split it by sub-domain. Example: one file per node type, not one inspector for all types.
- A route file over 80 lines: move the page body into its vertical.
- A folder with more than 25 files: look for sub-verticals.

## 5. The web app

```
apps/web/src/
  router.tsx               the router and its query client (TanStack Start reads it here)
  routes/                  thin TanStack Router files: createFileRoute, search and params, one page from a vertical
  shared/
    api/                   the oRPC client, query client, server URL, auth client, refusal codes, contract.ts (every derived API type)
    page/                  the parts of a page: site header, page heading, loader, logo
    shell/                 the app frame (AppShell): theme, sidebar, toasts, night notifications
    format/  code/  data-table/  media-query/   other named cross-cutting pieces, each with a barrel
  features/
    <vertical>/            projects, flows, runs, gates, schedules, agents, devices, settings, spaces, access, dashboard
      index.ts             the barrel: the only public surface
      queries.ts           query and mutation option factories, polling rules (or queries/ + mutations/)
      <name>-page.tsx      the page a route renders
      types.ts             this vertical's slice of the API types, when contract.ts is not enough
      components/ hooks/ lib/   when the vertical is big enough
    flows/                 canvas/, editor/ (+ inspector/ one file per node type, io/, lib/), start/ (Start run, the flow's inputs)
    runs/                  components/ (+ run-page.tsx, details/), hooks/, lib/, transcript/ (+ items/ per group of item kinds)
    settings/              settings-page.tsx, components/ (one file per card), hooks/use-settings-form.ts
```

Imports point one way, so no barrel closes a cycle. Biome's `noImportCycles` fails a cycle through barrels too.

- Routes and `router.tsx` may import any vertical, through its barrel.
- `shared/shell` composes the features. It is the only shared piece that imports a feature. No feature imports it.
- The other shared pieces import no feature. Every feature may use them.
- The features, from the bottom: `access`, `spaces`, `projects`, `agents`, then `flows`, `devices`, `gates`, `runs`, then `settings`, `schedules` and `dashboard`. A feature imports only features below it. The Settings page shows projects, flows, runs and agent defaults, so `settings` sits above them.
- Data can go the other way. Examples: the flow editor reads the settings, and the inbox lists runs. A vertical below the owner of the data imports the owner's `queries.ts` through a peer port (`scripts/check-verticals.ts`), not its barrel. A `queries.ts` imports only `shared/api`, so the port closes no cycle. Today `agents`, `flows` and `devices` read `settings/queries`. `flows` and `gates` read `runs/queries`. `agents` reads `devices/queries` (the Offers of a profile).
- `devices` and `runs` show each other (the Walker of a run, the runs of an Offer). `devices` reaches the run status badge through a peer port.
- A concept goes to the vertical that owns it in `docs/glossary.md`, not to its biggest user. Outcomes are declared by flow nodes, so `outcome-badge` is in `flows/canvas`. The Walker is a Device, so `walker-badge` is in `devices`.

- A route file declares the route (path, `ssr`, search and params validation) and renders one page from a vertical's barrel. It gives the params and the search to the page as props. It holds no other markup.
- A route loads data in a `loader` (`ensureQueryData`) only when that does not change what the person sees. No route has a loader today. The build prerenders the pages, so a loader also runs at build time. A loader that waits for data also blocks the navigation. Each page shows its own skeleton and its own error instead.
- Query options live in the vertical's queries. A component does not build `orpc.x.y.queryOptions(...)` for another vertical's data. It imports that vertical's factory from its barrel, or from its `queries.ts` through a peer port (see above).
- A query factory keeps the query key of the oRPC procedure (`orpc.x.y.queryOptions({ input })`). A polling rule (`refetchInterval` and its `meta`) is part of the factory, in the vertical that owns the data. A call site adds only its own options (`enabled`, `select`, `staleTime`).
- API types come from `shared/api` (`InferClientOutputs`). Never derive them again in a component.
- Rules that `@nightshift/flows` or the engine already has are imported, not copied. Example: template references, the harness catalog.
- UI follows `AGENTS.md`: shadcn components only.

## 6. Apps are composition roots

An app wires packages together and talks to the outside world. It does not hold domain logic.

- A file whose tests describe behaviour (not routes or wiring) belongs in a package.
- A composition root is a function (`createDaemon(env)`), not a module with side effects at import time.
- One boot sequence. The CLI and the desktop app call the same `startDaemon()`.
- Constants such as the default port have one home.

## 7. Enforcement

| Check | Where | Status |
| --- | --- | --- |
| Layer map: `scripts/check-layers.ts` compares each workspace dependency in a `package.json` with the table in section 1. Bun links only declared dependencies, so this is the real import graph. | lefthook pre-commit, CI | Active |
| Explicit `exports` in every `package.json` (section 3). A deep import fails `tsc` and fails at runtime. | TypeScript, Bun | Active |
| Biome `style/noRestrictedImports`: forbid a path that `exports` does not list, a relative path into another workspace, `./testing` outside tests, and `engine`, `agents`, `auth`, `db`, the `api` root and `flows/files` in `apps/web`. Biome replaces the options of a rule per override, so each override lists the whole set. | `biome.json` and its overrides | Active |
| Biome `correctness/noUndeclaredDependencies` and `suspicious/noImportCycles`. | `biome.json` | Active |
| CI on every pull request and push to `main`: `biome ci`, the layer check, the vertical check and its tests, `bun run check-types`, and `bun test` per workspace (without `*.live.test.ts`). | `.github/workflows/ci.yml` | Active |
| Vertical boundaries: `scripts/check-verticals.ts` finds the verticals from the file system (so no list can drift), then fails on any import past another vertical's barrel, apart from the listed leaf contracts and peer ports, and on a vertical without `index.ts`. Tests may deep-import. `bun scripts/check-verticals.ts <workspace>` checks a workspace that is not enforced yet. | lefthook pre-commit, CI | Active (enforced for: `apps/web`, `packages/agents`, `packages/engine`) |
| Barrel reachability: the same script fails when a barrel exports a name that no file outside the vertical imports. | lefthook pre-commit, CI | Active (enforced for: `apps/web`, `packages/agents`, `packages/engine`) |
| Top-level layout: the same script fails on a kind bucket at the top of `src/` (section 4), and on loose files in an app's `shared/`. | lefthook pre-commit, CI | Active (enforced for: `apps/web`, `packages/agents`, `packages/engine`) |

When a check exists, change its status to "Active". When a workspace follows section 4, add it to `ENFORCED` in `scripts/check-verticals.ts` and to the list above. Fix a violation, do not add an exception. If a rule is wrong, change this document first.

## 8. Known deviations

The code does not yet follow every rule. These are debts. Do not copy them into new code.

- `apps/web`: `routes/_auth/dashboard.tsx` holds its own markup: it is the old sign-in placeholder. `shared/api/orpc.ts` builds the account status key itself: the query client sends a refused session to sign in, and `shared/api` imports no feature.
- `apps/web/src/features/agents/harnesses.ts` keeps its own copy of the harness catalog (label, initials, note, default model, models, where the code goes). The web app may not import `@nightshift/agents`. `harnesses.list` returns these facts, but only to an owner. The pickers, the canvas and the new-node defaults need them before the API answers. The model lists also differ: the API sends every model of the adapter, the editor shows a short list of suggestions. The agents package now keeps one record per harness (`packages/agents/src/harnesses/`). The fix is to put the browser-safe facts of those records where the web app may read them, with the suggestions as their own field.
- The devices domain is split over four places (see section 2).
- `apps/server/src/services.ts` starts the daemon at import time. `apps/desktop` imports the server app through a temporary `exports` map in `apps/server/package.json`. The layer check allows `desktop` → `server` with a temporary exception.
- `@nightshift/engine/lease` is an extra entry. The desktop watchdog reads the health check before the daemon starts, and must not load the whole engine. Phase 4 moves the lease to the daemon.
- `packages/api/src/routers/index.ts` holds every procedure in one file. Most procedures declare no output schema. The engine owns wire schemas that the API uses.
- Only `apps/web`, `packages/agents` and `packages/engine` are cut into barrel verticals (`features/<vertical>/index.ts` in apps, `src/<vertical>/index.ts` in packages).

The migration plan that removes these debts is in the structure audit of 2026-10-20.
