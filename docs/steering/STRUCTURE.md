# Night Shift Codebase Structure

> The rules for where code lives. Read this before you add a file, a folder or a package.
> Refine it when a rule changes. Record the change in the ADR table of `TECH.md`.

Last updated: 2026-10-20

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
| `flows` | The flow document: schema, validation, migration, templates, rules. The `.nightshift/` file loader (`./files`, the only I/O). Schedules and agent profiles, because a flow document references them. | Running a flow. UI copy. |
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
- A consumer imports a package by its name and a listed entry. Never by a relative path into another package (`../../packages/agents/src/...`).

## 4. Verticals inside a package

- `src/` holds one folder per vertical. Name it with a domain word from `docs/glossary.md`: `runs/`, `gates/`, `schedules/`, `projects/`.
- The top of `src/` holds only `index.ts` and, for a runtime or app, its composition root.
- **No kind buckets.** Do not create `lib/`, `utils/`, `helpers/`, `hooks/`, `types/`, `types.ts` (as a catch-all), `common/`, `shared/` or `misc/`. Exception: `packages/ui` (the shadcn layout).
- Shared code gets its own named vertical, for example `time/` or `api/` in the web app. Its name says what it does.
- A vertical holds everything about its domain: components, hooks, query options, types, utilities, constants and tests.
- Another vertical imports only the files at the root of a vertical. Subfolders of a vertical are private to it.
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
  routes/            thin TanStack Router files: createFileRoute + one page from a vertical
  app/               the shell: router, sidebar, site header, page heading
  api/               the oRPC client, query client, server URL, contract.ts (shared derived types)
  <vertical>/        projects/, flows/, runs/, gates/, schedules/, agents/, devices/, settings/, spaces/, access/, dashboard/
    queries.ts       query and mutation option factories, polling rules
    types.ts         this vertical's slice of the API types
    *.tsx, *.ts      components, hooks and logic of this vertical, tests next to them
```

- A route file loads data (`loader`, `ensureQueryData`) and renders one page component. It holds no other markup.
- Query options live in the vertical's `queries.ts`. A component does not build `orpc.x.y.queryOptions(...)` for another vertical's data. It imports that vertical's factory.
- API types come from `api/contract.ts` (`InferClientOutputs`). Never derive them again in a component.
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
| Layer map: `scripts/check-layers.ts` compares each `package.json` dependency on `@nightshift/*` with the table in section 1. Bun links only declared dependencies, so this is the real import graph. | lefthook pre-commit, CI | Planned |
| Explicit `exports` in every `package.json`. A deep import fails `tsc` and fails at runtime. | TypeScript, Bun | Planned |
| Biome `style/noRestrictedImports` per package: forbid entries outside `exports`, `./testing` in production files, and engine/agents/auth/db in `apps/web`. | `biome.json` overrides | Planned |
| Biome `correctness/noUndeclaredDependencies` and `suspicious/noImportCycles`. | `biome.json` | Planned |
| CI on every pull request: `biome ci`, `bun run check-types`, `bun test`, the layer check. | `.github/workflows/ci.yml` | Planned |

When a check exists, change its status to "Active". Fix a violation, do not add an exception. If a rule is wrong, change this document first.

## 8. Known deviations

The code does not yet follow every rule. These are debts. Do not copy them into new code.

- Every package except `ui` exports `"./*"`.
- `apps/web` groups by kind: `lib/` (35 files), `hooks/`, `utils/`, loose `components/*.tsx`. Fat routes: `settings.tsx`, `runs/$runId.tsx`, `members.tsx`, `devices.tsx`, `index.tsx`.
- `packages/engine` has 58 flat files and five jobs. `engine.ts`, `events.ts` and `types.ts` are god files. `types.ts` is the hub of an import cycle.
- The devices domain is split over four places (see section 2).
- `apps/server/src/services.ts` starts the daemon at import time. `apps/desktop` imports `server/src/*`.
- `packages/api/src/routers/index.ts` holds every procedure in one file. Most procedures declare no output schema. The engine owns wire schemas that the API uses.
- The engine reads auth tables directly. `worktrees.ts` calls `git` with no port.
- `packages/agents` exports its fakes from the root. Each harness touches five files.

The migration plan that removes these debts is in the structure audit of 2026-10-20.
