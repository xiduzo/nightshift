# Night Shift Codebase Structure

> The rules for where code lives. Read this before you add a file, a folder or a package.
> Refine it when a rule changes. Record the change in the ADR table of `TECH.md`.

Last updated: 2026-10-27

Night Shift is a **layered vertical codebase**.

- **Layered:** packages sit in layers. A package imports only from packages in a lower layer.
- **Vertical:** inside a package, code is grouped by what it does (a domain), not by what it is (a kind).

Code that changes together lives together. A boundary that is not enforced is not a boundary.

## 1. Layers

| Layer | Packages | May import (`@nightshift/*`) |
| --- | --- | --- |
| 0. Foundation | `config`, `refusal`, `db`, `flows`, `ui`, `ui-native` | Nothing. `ui` and `ui-native` import only themselves. Every workspace may import `config` and `refusal`: `config` holds no code, and `refusal` is the one refusal type, which imports nothing. |
| 1. Capabilities | `auth`, `agents` | `auth`: `db`. `agents`: `flows`. |
| 2. Core | `engine` | `db`, `flows`, `agents`, `auth` |
| 3. Core domains | `devices`, `notifications` | Layer 2 and lower |
| 4. Surface | `api` | Layer 3 and lower |
| 5. Runtime | `daemon`, `client` | `daemon`: layer 4 and lower. `client`: only `api` (the `./client` entry, `import type`), `flows` (the root), `engine` (the `./run-status` entry) and `notifications` (the `./contract` entry). |
| 6. Apps | `server`, `desktop`, `web`, `mobile` | See below |

The apps:

- `apps/server` imports the runtime and lower layers. It holds the dev entry and the CLI.
- `apps/desktop` imports only the runtime (`@nightshift/daemon`).
- `apps/web` imports only `@nightshift/client`, `@nightshift/flows` (the browser-safe root, never `./files`) and `@nightshift/ui`. The API's types come through `@nightshift/client`. It never imports `api`, `engine`, `agents`, `auth` or `db`, and it does not declare them.
- `apps/mobile` imports only `@nightshift/client`, `@nightshift/flows` (the root) and `@nightshift/ui-native`. It never imports `@nightshift/ui` (the DOM components), `api`, `engine`, `agents`, `auth`, `db`, `devices`, `notifications` or `daemon`.
- `@nightshift/client` sits in layer 5 because it reads the API's types, but no runtime imports it: only the apps do. It uses no DOM, no React Native, and no Node or Bun API. React and TanStack Query are allowed.

Rules:

- Dependencies point down. A lower layer never knows a higher one.
- No package imports another app. An app is never a dependency.
- No cycles between packages. No cycles between the verticals of one workspace, type-only imports included. The only way back is a peer port (section 4).
- A workspace declares only the workspaces it imports. A dependency that no file imports comes out of `package.json`.
- When a lower layer must call a higher one, the lower layer declares a port (an interface). The higher layer implements it, and the composition root wires it.

## 2. What each package owns

One package is one bounded context. One domain has one home.

| Package | Owns | Does not own |
| --- | --- | --- |
| `config` | The shared TypeScript configuration (`tsconfig.base.json`). | Code. |
| `refusal` | The refusal type (`Refusal`): an error written for people, what happened and how to fix it, with its kind (`invalid`, `signed-out`, `forbidden`, `not-found`, `conflict`, `unavailable`). Every package throws it when it refuses a person's request. Any other error is a failure, and a person sees its plain words (`FAILURE_MESSAGE`, `wordsFor`). It imports nothing. | How a surface answers it: the API gives each kind its status (`readable` in `api`), and the peer protocol of `devices` keeps the codes older Devices know. |
| `db` | The libsql client, the drizzle schema, migrations, the data directory. | Queries of a domain. Those live with the domain. |
| `flows` | The flow document: one file per node type (`nodes/`: its schema, its checks, its output fields), the flow schema and migration (`document/`), the checks of a whole flow (`validate/`, with the template scope: what a template may read, for the checks and the editor's suggestions alike), templates, rules and variables (`template/`), list sources (`lists/`, `recipes/`), and the pure edits of a draft (`draft/`: new nodes, graph and outcome edits, renames and the name clash of the one namespace, the draft check). The built-in run policy (`DEFAULT_POLICY`), which the engine's settings fall back to. The `.nightshift/` file loader (`./files`, the only I/O). Flows are Night Shift data, so after [ADR 2](../adr/0002-flows-are-night-shift-data.md) only the one import on upgrade reads these files. Schedules and agent profiles, because a flow document references them. The harness catalog (`harnesses/`): what a person sees of each built-in harness, browser-safe, for the web app and `agents`. | Running a flow. UI copy: the editor passes its own words to `checkDraft`. |
| `ui` | shadcn/ui components and tokens. See `AGENTS.md`. | Anything domain-specific. |
| `ui-native` | React Native Reusables components (shadcn for React Native) and their tokens for `apps/mobile`, on Uniwind. Installed with the React Native Reusables CLI. See `AGENTS.md`. | Anything domain-specific. The DOM components (those are `ui`). |
| `auth` | Identity and access on Better Auth: login, two-factor, pairing, device keys, Spaces, members, roles, the access of a request and of a synced document. The auth tables. What Better Auth refuses for a Person's request, as a `Refusal` in Night Shift's words (`access/auth-refusals.ts`). | Device rows. |
| `agents` | Harness sessions, one harness adapter per harness, decider providers, MCP and CLI tools, pricing, skills. | Run order, retries, gates. |
| `engine` | The run engine: compile a flow to a graph, walk it, run policy, gates, the event log, the run read model, what a person does to a run (`run/actions.ts`: stop, answer a Gate, send a Signal, move, resume, restart a step, run again) and which of those a run allows (`run-status/`: one rule with its words, which imports only the refusal type, for the apps too), projects and worktrees, the flows and schedules of a project behind one port (`flows/project-flows.ts`: `ProjectFlows`, for every read and save; `fileProjectFlows` keeps them in the Clone's `.nightshift/` folder; `documentProjectFlows` (`flows/flow-document.ts`) keeps them in the Project's flow documents, `flows:<id>` for the flows and schedules and `flows-history:<id>` for each Flow revision; `testing/project-flows-contract.ts` holds the tests every adapter passes), the cleanup of what ended runs left on this computer (`cleanup/`: the Branches overview, removing a worktree or local branches, and the scheduled sweep that removes only what is merged or pushed), the device-config document and the edits that keep it whole (`device-config/edits.ts`: a profile names connections and CLI tools that exist, a rename or a removal changes the profiles that name it). The dashboard (`dashboard/`): its numbers, computed from the runs of one project or of several Spaces (`projectDashboard`, `spacesDashboard`), one flow's health (`summarizeFlow`), and the reader's time zone (`isTimeZone`). The words it shares with its callers and the Devices (`contract/`: `Actor`, `MemberChange`, `StartRunInput` and its schema, `Placement`, `OwnDevice`, and the ports a vertical asks of the devices: `DeviceDirectory`, `Relay`, `OffersPort`). `contract/` imports no other vertical, so every vertical names those types without a cycle. The engine's own interface (`Engine`, `SpaceEngine`, `EngineOptions`) and the port it walks with (`Peers`) sit with `createEngine` in `run/`. | Other Devices and Hosts: the engine declares the port it walks with (`Peers`, in `run/peers.ts`), and `devices` implements it. The Device rows (`device`, `host_space`): the engine reads this computer's Device, the names of Devices and the Spaces a Host keeps through `DeviceDirectory` (`contract/directory.ts`), which `devices` implements too. Process concerns such as the lease and OS dialogs (in `daemon`). |
| `devices` | This computer among other Devices and Hosts: the engine's `Peers` port (`createPeerEngine`) and `DeviceDirectory` port (`deviceDirectory`), this computer's own Device row and its owner (`registry/self-device.ts`), the device registry, Placement, Offers (with the Offer admission, `offers/admission.ts`: every check of a call of a run on this computer, by either path, and one slot map per Offer), the archive and the exchange of run history (`RunHistoryExchange`: rows by cursor, the ingest in one transaction and every consequence read from the log, Commands applied once; the Device's half, `DeviceExchange`, and the Host's, `HostExchange`, both go through it), the Links to Hosts and pairing, this computer as a Host, the work relay, and the peer protocol: the procedures a Device calls on its Host (`link`, `pairing`, `sync`, `archive`, and the work relay under `devices`). `contract/` writes them once as an oRPC contract (`hostContract`: each procedure's input and output schemas, the Device key permission it needs, its refusals), with the wire schemas and types and `HostRelay`. Its client type is `HostClient`. `host/router.ts` implements it once (`hostRouter`, with the Device key check), over `HostExchange` and the Host. `contract/` imports no other vertical, so every vertical names those types without a cycle. The API's ports `Devices`, `HostExchange` and `Offers`. The devices runtime (`wire.ts`, `startDevices`): the one call the daemon makes. It builds the engine with its peers and every devices piece, and owns their `bun --hot` reload in one kept slot: the runtime before stops its Links and presence sweep and disposes its engine, and the next one takes over the work hub, the applied commands, the calls it serves for a Host and the Offers in use. | The execution port (`Device`) and this computer as a Device (`localDevice`). Those stay in `engine`. The procedures a Person calls (the Devices page, approving a pairing, Offers, the phones, `nightshift join`): those are `api`. |
| `notifications` | The notifier (`notifier/`): it reads the run events that land in this Replica (`Engine.onRunEvents`) and decides whom to tell about a new Gate, a finished run and a failed run. The notification contract (`contract/`: the notification keys, `runId:stepId` for a Gate and `runId:end:<seq>` for a run's end, the push categories, channels, buttons and data, and where a tap goes). `contract/` imports nothing, so every screen can read it: the client re-exports it. The rules (answer once, clear everywhere, the active screen first, one sender per Space, quiet hours, once per key, no content in a push). The Person's notification settings (`settings/`, with the one-time copy of a computer's three old notification switches and `adoptComputerSwitches`), the push targets (`targets/`: each browser, phone and desktop app), what was sent, held and withdrawn (`deliveries/`). The channels behind one port, `NotificationChannel` (`channels/`): the in-app stream, Web Push (`web-push.ts` on the `web-push` library, with the VAPID keys the sending daemon makes once, `vapid-keys.ts`), and Expo Push (`expo.ts` on `expo-server-sdk`, with its receipts), each with a fake. The desktop notification (`desktop/`): its channel, the OS port `DesktopNotifier` (Electrobun's notification from the desktop app, else `systemDesktopNotifier`: `terminal-notifier` or `osascript`, `notify-send`), and the window port `DesktopWindow`. Its tables. `wire.ts` composes them (`createNotifications`). See `docs/research/mobile.md`. | The run log and the Gates (those are `engine`). The Person's session (that is `auth`). The in-app stream procedure (that is `api`, which calls the notifier). |
| `api` | The oRPC surface: procedures per domain, middleware, the router type the web app consumes. The one rule for errors at its seam (`readable` in `procedures.ts`): an oRPC error passes on as it is (a declared one too), a `Refusal` is the status of its kind with its words, `HostUnreachableError` is `HOST_UNREACHABLE` (503), and any other error is a failure: a 500 with plain words, logged with the procedure's path. Every procedure declares an input schema, an output schema and a one-line summary. That makes the router the one source for the web client, OpenAPI and any agent tool surface (MCP). It mounts the peer protocol of `devices` (`hostRouter`) at its paths (`devices/peer.ts`), and gives it the phones of a Person from the notifier. | Domain logic. A procedure validates, checks access and calls one domain function. The peer protocol a Device calls on its Host: that is `devices`, a wire protocol between daemons, not the product API. |
| `daemon` | Boot and runtime: `createDaemon(env)` (the composition root), `startDaemon()` (the one boot sequence), the Hono app and its routes, the lease, health, the document sync transport, signals, the hot-reload handover, the harness table of this computer, OS dialogs, "Keep this computer awake" (`keep-awake/`: the OS's sleep lock behind a port, `caffeinate` or `systemd-inhibit`). The notifier of this computer (`notifications/`: `wireNotifications` gives `createNotifications` its channels and this computer's desktop, registers the desktop as its owner's screen, and hands the old notification switches to the owner on a settings save). It starts `devices` with one call (`startDevices`), which gives it the engine and the API's ports and hands itself over on a hot reload. It keeps its relay across hot reloads. | Domain logic. The access policy of a synced document: that is `documentAccess` in `auth`. |
| `client` | Client logic that `apps/web` and `apps/mobile` share: the oRPC query and mutation option factories with their query keys and polling rules, the run-stream reconnect loop (`afterSeq` and dedup, a stop on `NOT_FOUND`), the live cache (`live/`: the one follower of a Host for both apps. `useFollowHost` follows the notifications stream and reconnects, reads again what each item changes, shows a notice for an item with `alert` and closes the notifications of Gates that no longer wait, through the app's adapter of `ShownNotifications`. `useAnswerGate` applies the one Gate refusal rule. `useRunActed` reads a run again after a person acts on it, in the burst of the stream. `useLiveRun` follows one run's stream in batches and keeps its steps, status and entries), the view types derived from the API, the notify rules of the in-app stream, which actions a run allows, as the engine rules them (`runs/actions.ts` passes on `@nightshift/engine/run-status`), the answer to a Gate (`gates/answer.ts`: `answerGate` turns a refusal of `gates.resolve` into an outcome, and `gateRefusalText` gives its words), the push contract as the screens read it (`notifications/push.ts`: it re-exports `@nightshift/notifications/contract` and adds `staleGates`, the rule that clears the notification of a Gate that no longer waits), and the words both apps show for one thing (a cost, when a run started, how long ago, a computer's system, a phone delay), with the time now that keeps "how long ago" current (`useNow`). Browser- and React-Native-safe. | The oRPC client instance and its transport (each app makes its own: `fetch` on the web, `expo/fetch` on the phone). Components. Domain rules of `flows` or the engine. |
| `apps/server` | The dev entry (`src/main.ts`, run by `bun --hot`), the CLI (`src/features/cli/`, entry `src/cli.ts`), the binary build (`scripts/`), the env schema, and the tests that start whole daemons as processes (`test/`). | Domain logic. |
| `apps/desktop` | Tray, window, updates, watchdog. | Any logic of the daemon. |
| `apps/web` | The UI. One vertical per product area. | Rules that the engine or `flows` already has. |
| `apps/mobile` | The phone app on Expo (Expo Router): a Person's client of a Host that reads and acts. One vertical per product area. | Flow and schedule editing. A Replica, Yjs or libsql. Logic that `client` or a package has. |

### Tables have owners

Each table has one owning package. The schema file names the owner above each table group. Another package reads or writes that table only through the owner's functions. Example: the engine asks `@nightshift/auth` for the members of a Space. It does not query `member`. Example: the exchange of `@nightshift/devices` copies run history between Replicas through the engine's `RunHistory` (`PeerContext.history`). It does not query `run`, `step`, `agent_session` or `event`.

The schema is in `packages/db/src/schema/`, one file per owner: `auth.ts`, `devices.ts`, `projects.ts`, `runs.ts`, `device-config.ts`, `engine.ts`, `daemon.ts` and `notifications.ts`. A comment above each group of tables names the owning package and vertical. `schema/index.ts` lists every file with its owner. `auth:generate` writes `auth.ts`, so only the index names its owner. Put a new table in the file of its owner. When a table moves to another file, its migrations stay the same: `drizzle-kit generate` must report no changes.

Test fixtures and the fakes of `./testing` may set up and read any table. Example: the engine's `aloneDirectory` reads the `device` rows that a test adds.

### Ports for external I/O

Every call to `git`, `gh`, a harness CLI, `osascript` or another OS program goes through a port. The port is an interface in the package that needs it. The adapter implements it. Tests use a fake adapter.

## 3. Public surfaces

Each package lists its public entry points in `package.json` `exports`.

- **No wildcard exports** (`"./*"`). Every entry point is named on purpose.
- Exception: `@nightshift/ui` keeps `./components/*`, `./hooks/*` and `./lib/*`. That is the shadcn layout, and `components.json` depends on it. `@nightshift/ui-native` keeps `./components/ui/*`, `./hooks/*` and `./lib/*` for the same reason: the React Native Reusables CLI puts its components in `components/ui/`.
- **An entry points at a barrel or a top-level file:** `src/index.ts`, a file directly in `src/` (`src/files.ts`), or a barrel one folder down (`src/migrate/index.ts`, `src/testing/index.ts`). An entry that must point deeper is a light entry, listed with its reason in `LIGHT_ENTRIES` of `scripts/check-layers.ts`. Today that is `@nightshift/agents/harness-facts`: the barrel of harnesses brings every harness and the session, which are not browser-safe.
- **Every entry has an importer in another workspace**, tests included. An entry nobody imports comes out of `exports`.
- **Every value name on an entry has an importer in another workspace**, tests included. A name only the package itself uses comes off the entry. For an entry that is also a vertical's barrel, a file of the package outside that vertical counts too, and the root `index.ts` counts for the names it passes on that are used in turn. Types are exempt: a type that the emitted declaration of another package names must stay on an entry (TS2883, see below).
- **No `export *`.** Every entry and barrel names what it exports. The one exception is the drizzle schema index (`@nightshift/db/schema`): drizzle reads every table from it.
- `index.ts` exports what consumers use. It is not a barrel of every file.
- Test helpers, fakes and fixtures are public only through `./testing`. Production code never imports `./testing`.
- An entry that `client` reads for the web app and the phone app is type-only and browser-safe (`@nightshift/api/client`). The apps read the API types through `client`.
- A type that the emitted declaration of another package names must be on an entry. Example: the API router type names engine and auth view types, so their roots export them. Without this, `tsc` fails with TS2883.

The entries today:

| Package | Entries |
| --- | --- |
| `agents` | `.`, `./harness-facts`, `./pricing`, `./tools` (the MCP client the Tool node calls), `./types` (the port barrel: the harness contract's types and its shell quoting), `./testing` (fakes, `fixturePath(name)`). The engine uses the four light entries: the root brings every harness and decider (their TanStack packages load on first use). `./harness-facts` is browser-safe. |
| `api` | `.` (`appRouter` and its types, `runSpaceFor`: the run's Space for a Person, for the daemon's run file routes), `./client` (types only, for `client`, which passes them on to `apps/web` and `apps/mobile`), `./context` |
| `auth` | `.`, `./testing` |
| `client` | `.` (`createApiClient`, `createQueryUtils`, the `create<Vertical>Queries` and `create<Vertical>Mutations` factories, `useFollowHost`, `useLiveRun`, `useAnswerGate`, the seam `ShownNotifications` (with `Notice`, `ListedNotification`), `EntryFold`, `HostApi`, `mergeSteps`, `answerGate` and `gateRefusalText`, which actions a run allows (`runActions` and `whyNot`, passed on from `@nightshift/engine/run-status`), the notify rules, the push contract (`gateKey`, `isGateKey`, `PUSH_CATEGORY`, `PUSH_ANDROID_CHANNEL`, `PUSH_ACTION`, `PUSH_MESSAGE_KINDS`, `PushData`, `pushDataOf`, `withdrawKeyOf`, `PushRoute`, `routeOf`, `webPathOf`, `staleGates`), the shared formatters (`formatCost`, `formatKnownCost`, `costLabel`, `whenLabel`, `agoLabel`, `platformName`, `PHONE_DELAYS`, `phoneDelayLabel`, `useNow`), the view types) |
| `db` | `.`, `./schema`, `./data-dir`, `./migrate` |
| `devices` | `.` (with `hostContract`, `hostRouter` and `HostClient`: the peer protocol, for the API to mount), `./testing` (`withPeers`, `inMemoryHost`: the Host's own router in memory, behind `HostClient`, `pairedReplicas`: a Host and its paired Device in one process; only the tests of `devices` use it today, see section 8) |
| `daemon` | `.` (`startDaemon`, the CLI's and the desktop app's helpers: `prepareDaemonEnv`, `checkHealth`, `chatRun` (a run as the authoring tools read it, for `nightshift mcp`), `DEFAULT_PORT`, `DESKTOP_PORT`, the web UI handler, the desktop types `DesktopScreen`, `DesktopNotifier`, `DesktopWindow`), `./heartbeat` (`readHeartbeatFile`: the lease heartbeat as another process reads it, Bun and Node only, for the desktop watchdog's Worker) |
| `engine` | `.`, `./run-status` (the run's status and the actions it allows: `runActions`, `whyNot`, `RunRefusal`, a `Refusal` of the kind its rule is; imports only `@nightshift/refusal`, for `client`), `./testing` |
| `flows` | `.`, `./files` |
| `refusal` | `.` (`Refusal`, `RefusalKind`, `FAILURE_MESSAGE`, `wordsFor`, from `src/refusal.ts`; imports nothing) |
| `notifications` | `.` (`createNotifications`, `createInAppChannel`, `createExpoChannel`, `engineRunEvents`, `oneSenderPerSpace`, `createDesktopChannel`, `systemDesktopNotifier`, the settings and push target schemas, the channel port `NotificationChannel`, the Expo port `ExpoClient`, the desktop ports `DesktopNotifier` and `DesktopWindow`), `./contract` (the notification contract: keys, push data, where a tap goes; imports nothing, for `client`), `./testing` (`fakeChannel`, `fakeRunEvents`, `fakeWebPushSender`, `fakeVapidKeys`, `testDatabase`, `fakeDesktopNotifier`, `fakePrograms`, `fakeExpoClient`) |
| `ui` | `./components/*`, `./hooks/*`, `./lib/*`, `./globals.css` |
| `ui-native` | `./components/ui/*`, `./hooks/*` (no hook yet: the CLI's `hooks` alias in `components.json` puts one there), `./lib/*` (`lib/theme`: the theme colors in hex, the run status colors too, for JavaScript and for the widgets), `./global.css` (the theme tokens, for Uniwind) |

- A consumer imports a package by its name and a listed entry. Never by a relative path into another package (`../../packages/agents/src/...`).

## 4. Verticals

Every app and every package (except `ui`, `ui-native` and `config`) is cut into verticals. The model is the one yapyap uses.

### What a vertical is

- A vertical is a folder named with a domain word from `docs/glossary.md`: `runs/`, `gates/`, `schedules/`, `projects/`.
- Its `index.ts` is a barrel. The barrel is the **only** public surface of the vertical. A barrel holds only import and export statements, and so does a package's root `index.ts`: code goes in a file of the vertical.
- Code outside the vertical imports from the barrel only. A deep import into another vertical (`features/runs/components/run-list`) is an error.
- Inside the vertical, code uses relative imports and may reach any file.
- A vertical holds everything about its domain: components, hooks, query options, types, utilities, constants and tests.
- Inside a vertical, kind folders are allowed when the vertical is big enough: `components/`, `hooks/`, `lib/`, `queries/`, `mutations/`. A small vertical stays flat.
- Every name on a barrel has an importer outside the vertical. A name nobody imports comes off the barrel.

### Where verticals live

| Workspace | Verticals in | Also at the top of `src/` |
| --- | --- | --- |
| An app (`apps/web`, `apps/server`, `apps/desktop`, `apps/mobile`) | `src/features/<vertical>/` | `routes/` (web), `app/` (mobile: the Expo Router files, thin like the web routes), `shared/`, the generated `env.ts`, and the entry files: `router.tsx` (web), `main.ts`, `cli.ts`, `join-cli.ts` and `auth-config.ts` (server), `bun/` (desktop, the Electrobun entry) |
| A package (`engine`, `agents`, `flows`, `api`, `auth`, `db`, `daemon`, `devices`, `notifications`, `client`) | `src/<vertical>/` | `index.ts` (composes the vertical barrels into the package API), the other entries that `exports` names (`api`: `client.ts`, `context.ts`. `flows`: `files.ts`. `daemon`: `heartbeat.ts`), `testing/`, the generated `env.ts` (`db`), and the files that compose the verticals or that every vertical uses: `auth.ts` (the Better Auth instance), `daemon.ts` and `start.ts`, `router.ts`, `procedures.ts` and `output.ts` (`api`), `wire.ts` (`devices`, `notifications`) |

- **The top of an app's `src/`** holds only `features/`, `shared/`, the one entry folder its framework reads (`routes/` on the web, `app/` on the phone, `bun/` on the desktop, listed in `ENTRY_DIRS` of `scripts/check-verticals.ts`) and entry files. No other folder.
- **`shared/` (apps only)** holds cross-cutting code that is not a product area: the API client, logging, the page shell, time formatting. Each piece in `shared/` is a named folder with its own barrel (`shared/api/`, `shared/time/`). No loose files in `shared/`.
- **No kind buckets at the top of `src/`.** Do not create `src/lib/`, `src/utils/`, `src/helpers/`, `src/hooks/`, `src/components/`, `src/types/`, `src/common/` or `src/misc/`. Exceptions: `packages/ui` and `packages/ui-native` (the shadcn layout).
- **No catch-all names at any depth.** No file named `utils`, `util`, `helpers`, `helper`, `common`, `misc` or `shared`, and no folder named `utils`, `util`, `helpers`, `helper`, `common` or `misc`. Name a file for what it holds (`nodes/base.ts`: what every node type shares).
- No catch-all `types.ts` for a whole package. Types live in the vertical that owns them.
- **Files outside `src/`** (config files, scripts, `test/`) belong to no vertical. They import a vertical through its barrel, like any other file, and count as its importers. A file in `test/` is a test.
- **Imports stay inside the workspace.** A relative import never leaves it, and no file imports its own package by name. Production code never imports a test, a fake, a fixture or a test helper.

### Exceptions are listed, not implied

Two exceptions exist, as in yapyap. Each one is listed by name in `scripts/check-verticals.ts` with a comment that says why.

- **Leaf contract:** a pure-data file (no imports of its own) that a vertical exposes past its barrel, because importing the barrel would close a module-init cycle or load what the importer cannot load. A leaf contract that imports anything fails.
- **Peer port:** two verticals that depend on each other cross only through one named port file per direction. Every other deep import between them stays banned. Often only one direction closes the cycle. Then only that direction has a port, and the other direction imports the barrel. A port, and every file of its vertical that it imports, imports no other vertical than a shared piece, so the port closes no cycle.

The check fails on a leaf contract or a peer port that nothing uses any more, so neither outlives its reason.

Today there is one leaf contract: `features/updates/update-feeds.ts` in `apps/desktop`. The build config (`electrobun.config.ts`) reads the feeds, and the barrel of `updates` loads `electrobun/main`, which only the app's main process can load. There are seven peer ports, all in `apps/web` (section 5).

### Growth

- Start a new concept inside the vertical that uses it. Promote it to its own vertical when a second vertical needs it.
- A new package is right only when a vertical must sit in a different layer than its host, or when two apps need it.

### Size limits

These are signals, not hard limits. A file past the limit needs a reason in its header comment.

- A source file over 600 lines (tests do not count): split it by sub-domain. Example: one file per node type, not one inspector for all types.
- A route file over 80 lines: move the page body into its vertical.
- A folder with more than 25 source files (tests do not count, they stay next to their files): look for sub-verticals.

## 5. The web app

```
apps/web/src/
  router.tsx               the router and its query client (TanStack Start reads it here)
  routes/                  thin TanStack Router files: createFileRoute, search and params, one page from a vertical and its preload
  shared/
    api/                   the oRPC client, query client, server URL, auth client, contract.ts (the API types only the web app needs; the rest come from @nightshift/client)
    page/                  the parts of a page: site header, page heading, loader, logo
    shell/                 the app frame (AppShell): theme, sidebar, toasts, the notifications stream, the tab badge
    format/  code/  data-table/  media-query/   other named cross-cutting pieces, each with a barrel
  features/
    <vertical>/            projects, flows, runs, gates, schedules, agents, devices, notifications, settings, spaces, access, dashboard
      index.ts             the barrel: the only public surface
      queries.ts           query and mutation option factories, polling rules (or queries/ + mutations/)
      <name>-page.tsx      the page a route renders
      types.ts             this vertical's slice of the API types, when contract.ts is not enough
      components/ hooks/ lib/   when the vertical is big enough
    flows/                 canvas/, editor/ (+ inspector/ one file per node type, io/, lib/), start/ (Start run, the flow's inputs)
    runs/                  components/ (+ run-page.tsx, details/), hooks/, lib/, transcript/ (+ items/ per group of item kinds)
    settings/              settings-page.tsx, components/ (one file per card), hooks/use-settings-form.ts
    agents/                connections/ (MCP servers, CLI tools and secrets, on the Agents page)
    gates/                 inbox/ (the Needs-you inbox)
    notifications/         the stream (use-notification-stream.ts: the live cache follows the Host, with this browser's adapter in browser-notifications.ts), this browser's Web Push (browser.ts, with public/sw.js), components/ (the notification settings and screens cards)
```

Imports point one way, so no barrel closes a cycle. Biome's `noImportCycles` fails a cycle through barrels too, and `scripts/check-verticals.ts` fails a cycle between verticals with type-only imports in it.

- Routes and `router.tsx` may import any vertical, through its barrel.
- `shared/shell` composes the features. It is the only shared piece that imports a feature. No feature and no other shared piece imports it: only the routes and the entry files do. The check enforces this, tests included.
- The other shared pieces import no feature (checked, tests included). Every feature may use them. When a shared piece needs a feature's rule, `router.tsx` passes it in. Example: `createQueryClient` takes `sendToAccess` from `access`, which sends a refused session to sign in.
- The features, from the bottom: `access`, `spaces`, `projects`, `agents`, then `flows`, `devices`, `gates`, `runs`, then `notifications`, then `settings`, `schedules` and `dashboard`. A feature imports only features below it. The notifications stream follows the Host for every page, so `notifications` sits above the pages it keeps live. The Settings page shows projects, flows, runs, agent defaults and the notification settings, so `settings` sits above them.
- Data can go the other way. Examples: the flow editor reads the settings, and the inbox lists runs. A vertical below the owner of the data imports the owner's `queries.ts` through a peer port (`scripts/check-verticals.ts`), not its barrel. A `queries.ts` imports only `shared/api`, so the port closes no cycle. The check fails on a port that imports another feature. Today `agents`, `flows` and `devices` read `settings/queries`. `flows` and `gates` read `runs/queries`. `agents` reads `devices/queries` (the Offers of a profile).
- `devices` and `runs` show each other (the Walker of a run, the runs of an Offer). `devices` reaches the run status badge through a peer port.
- A concept goes to the vertical that owns it in `docs/glossary.md`, not to its biggest user. Outcomes are declared by flow nodes, so `outcome-badge` is in `flows/canvas`. The Walker is a Device, so `walker-badge` is in `devices`.

- A route file declares the route (path, `ssr`, search and params validation) and renders one page from a vertical's barrel. It gives the params and the search to the page as props. It holds no other markup.
- A route starts the data of its page in a `loader` that does not wait. It calls the vertical's `preload<Page>` (a `preload.ts` beside the page), which calls `preloadQuery` (`shared/api`): `ensureQueryData` in the browser only, with any error left to the page. The router preloads a route when you point at its link (`defaultPreload: "intent"`). A loader never waits for data: that blocks the navigation, and the build prerenders the pages, so a loader also runs at build time, without a session. Each page shows its own skeleton and its own error. A `preload.ts` imports only query options, because the route tree, and so every page, loads it.
- A vertical's `queries.ts` builds its factories from `@nightshift/client` on the app's `orpc` (`createRunQueries(orpc)`), when the package has them. The web-only ones (settings, access, agents) stay in the vertical.
- Query options live in the vertical's queries. A component does not build `orpc.x.y.queryOptions(...)` for another vertical's data. It imports that vertical's factory from its barrel, or from its `queries.ts` through a peer port (see above).
- A query factory keeps the query key of the oRPC procedure (`orpc.x.y.queryOptions({ input })`). A polling rule (`refetchInterval` and its `meta`) is part of the factory, in the vertical that owns the data. A call site adds only its own options (`enabled`, `select`, `staleTime`).
- API types come from `shared/api`. It passes on the view types of `@nightshift/client` and adds the ones only the web app needs (`contract.ts`, from `ApiOutputs`). Never derive them again in a component.
- Rules that `@nightshift/flows` or the engine already has are imported, not copied. Examples: template references, the harness catalog, what a template may read (`templateScope`), a name clash (`nameClash`), the built-in run policy (`DEFAULT_POLICY`), which actions a run allows (`runActions`, `whyNot`). A rule only a package of the server can answer comes from the API: the Traversals of a called flow are `calledTraversals` of `runs.get`, the ranges of the dashboard are the ranges its reply has (`summary.nights`, `summary.activity`), and how long a trusted browser skips the code is `twoFactor.trustedBrowserDays` of `account.status`.
- UI follows `AGENTS.md`: shadcn components only.

### The phone app

```
apps/mobile/src/
  app/                     thin Expo Router files: one screen from a vertical
  shared/
    api/                   the auth client per Host, the Host address, the transport (expo/fetch + cookie), the query client (app focus, network), the reads kept between starts
    page/  empty/          the screen body (Screen, with an optional footer) and the empty state
    feedback/              ErrorAlert: what went wrong on a screen, and how to try again
    format/                a time of day (formatTime); the time now for "12 min ago" (useNow), costs and the words of "5 min ago" come from @nightshift/client
    in-front/              whether the app is in front (useInFront): the streams follow only then
    refresh/               reading a screen again: on focus and on pull-down (useScreenRefresh)
    theme/                 useThemeColors: the light or dark colors for props that take a color
    tone/                  the status map, pure: tone, icon name and word of a run status, a step, a step kind
    status/                StatusBadge and StatusText: a tone drawn with its icon and word
    list/                  ListGroup, ListRow, SectionHead: lists in a card
    header/  avatar/       LargeTitleHeader, HeaderButton, AvatarButton; InitialsAvatar
    tiles/  chips/         StatTile and FactTile two by two; filter chips (ChipRail, Chip)
    trail/  action-bar/    a run's steps as a timeline (StepTrail); the bar at the bottom of a screen (ActionBar)
    shell/                 the app frame (AppShell) and the tabs (AppTabs: native tabs on iOS, JS tabs on Android)
  features/
    host/                  sign-in (address, the Host code, two-factor or backup code), the session, useHostQueries
    spaces/                the Space picker of Runs, Projects and New run, the Space remembered per Host
    glance/                the glances outside the app: the home screen widget (Gates that wait, the latest runs) and a run followed on the lock screen (Live Activity, Android ongoing notification), on expo-widgets
    push/                  notifications on this phone: the permission card, the Expo push token registered with the Host, the categories and Android channels, the lock-screen buttons and withdraws (background task), the banner in front and the live cache's adapter (phoneNotifications), where a tap goes
    devices/               the person's computers and whether each can run a flow now (the Computers sheet)
    dashboard/             how each flow did, or each project over every Space (the Flows sheet)
    home/  inbox/  runs/  projects/  start/  search/  settings/
```

- The phone UI and its building blocks are in `docs/research/mobile.md`, "Phone UI". A block composes React Native Reusables pieces and tokens. A block a screen needs and no block covers goes in a new named `shared/<name>/`, or in the vertical when only it uses the block.

- The features, from the bottom: `host`, `spaces`, `glance`, `push`, `devices`, then the tabs. `shared/shell` composes them, as on the web. `push` sits below the screens because the inbox and Settings show its card. The shell gives its adapter (`phoneNotifications`) to the live cache (`useFollowHost`). `glance` sits below `push` because the background task of a push updates the widget.
- `app/_layout.tsx` calls `startPushHandling()` in its module scope: iOS and Android start the app for a push in the background, and the background task must be defined before any screen renders.
- A screen takes query options from `@nightshift/client` on the Host's client: `useHostQueries(createRunQueries)`. The phone keeps no module-level `orpc`, because its client changes with the Host.

## 6. Apps are composition roots

An app wires packages together and talks to the outside world. It does not hold domain logic.

- A file whose tests describe behaviour (not routes or wiring) belongs in a package.
- A composition root is a function (`createDaemon(env)`), not a module with side effects at import time.
- One boot sequence. The CLI and the desktop app call the same `startDaemon()`.
- Constants such as the default port have one home.
- Today: `createDaemon(env)` is in `packages/daemon/src/daemon.ts`, `startDaemon()` in `start.ts`. `bun run dev` (`apps/server/src/main.ts`), `nightshift serve` and the desktop app call `startDaemon()`. `DEFAULT_PORT` is in `daemon/src/runtime/port.ts`.

## 7. Enforcement

The pre-commit hook is `lefthook.yml` (install it with `bun lefthook install`). CI is `.github/workflows/ci.yml`. It runs on every pull request and every push to `main`.

| Check | How it runs | Status |
| --- | --- | --- |
| Layer map (L1): `scripts/check-layers.ts` compares each workspace dependency in a `package.json` with the table in section 1. Bun links only declared dependencies, so this is the real import graph. | lefthook pre-commit (when a `package.json`, a `tsconfig`, `biome.json` or a source file changes), CI | Active |
| Package rules: the same script fails on a declared workspace dependency that no file imports or extends (L2), an entry that no other workspace imports (L3), an entry that points past a barrel and is not a light entry (L4), and an allow-list of `noRestrictedImports` in `biome.json` that does not name exactly the entries of every `package.json` (L5). Exceptions (`EXCEPTIONS`, `ENTRY_EXCEPTIONS`, `LIGHT_ENTRIES`) fail once they are not needed. | lefthook pre-commit, CI | Active |
| Explicit `exports` in every `package.json` (section 3). A deep import fails `tsc` and fails at runtime. | TypeScript (`bun run check-types`, CI), Bun at runtime | Active |
| Biome `style/noRestrictedImports`: forbid a path that `exports` does not list, a relative path into another workspace, `./testing` outside tests, and `engine`, `agents`, `auth`, `db`, every `api` entry and `flows/files` in `apps/web`. In `apps/mobile`, everything but `client`, the `flows` root and `ui-native`. In `packages/client` (tests apart), every `@nightshift` import but `api/client`, `engine/run-status`, the `flows` root and `notifications/contract`. `packages/client/src/platform-free.test.ts` also fails on any other package, on `node:` and `bun:`, and on a global of the DOM, Node or Bun, and on any import in the leaves it reads (`engine/run-status`, which may import only `refusal`, `notifications/contract` and `refusal`). Biome replaces the options of a rule per override, so each override lists the whole set, and the layer check (L5) keeps the lists equal. | `biome.json`: lefthook pre-commit (staged files), CI (`biome ci`) | Active |
| Biome `correctness/noUndeclaredDependencies`, `suspicious/noImportCycles` and `performance/noReExportAll` (off only for the drizzle schema index). | `biome.json`: lefthook pre-commit (staged files), CI (`biome ci`) | Active |
| Vertical boundaries: `scripts/check-verticals.ts` finds the workspaces and their verticals from the file system, so no list can drift and a new workspace is checked from its first commit. It reads every file of a workspace, not only `src/`. It fails on any import past another vertical's barrel, apart from the listed leaf contracts and peer ports, and on a vertical without `index.ts`. It also fails on a relative import that leaves the workspace, an import of the workspace's own name, production code that imports a test, a fake, a fixture or a test helper, a peer port that imports another feature, and a leaf contract or peer port that nothing uses. Tests may deep-import. `bun scripts/check-verticals.ts <workspace>` checks one workspace. | lefthook pre-commit (when a source file, a `package.json` or a `tsconfig.json` changes), CI | Active (every workspace except `ui`, `ui-native` and `config`) |
| Barrel reachability: the same script fails when a barrel exports a name that no file outside the vertical imports, and when a barrel or a package's root `index.ts` holds a statement that is not an import or an export. | lefthook pre-commit, CI | Active (every workspace except `ui`, `ui-native` and `config`) |
| Entry names: the same script fails when a value name on a package entry has no importer in another workspace (section 3). Types are exempt. `PENDING_NAMES` lists names that code on its way imports, and fails once they have an importer. | lefthook pre-commit, CI | Active (the entries of every workspace except `ui`, `ui-native` and `config`) |
| Cycles between verticals: the same script fails on a cycle between the verticals of a workspace, type-only imports included. An import through a peer port or of a leaf contract is not part of a cycle. `KNOWN_CYCLES` lists the ones that wait for their fix, and fails once the cycle is gone. Today it is empty. | lefthook pre-commit, CI | Active |
| Top-level layout: the same script fails on a kind bucket at the top of `src/`, a folder at the top of an app's `src/` other than `features/`, `shared/` and its entry folder, a loose file in an app's `shared/`, a shared piece that imports a feature, a vertical that imports `shared/shell`, and a catch-all file or folder name at any depth (section 4). | lefthook pre-commit, CI | Active (every workspace except `ui`, `ui-native` and `config`) |
| The checks have tests: `scripts/check-verticals.test.ts` and `scripts/check-layers.test.ts` prove each rule on small workspaces, with one tree that breaks it and one that keeps it, and that each script passes on this repository. `scripts/test-workspaces.test.ts` does the same for the list of tested workspaces. | `bun test ./scripts/`: lefthook pre-commit (when a check script changes), CI | Active |
| Types and tests: `bun run check-types` (every workspace, with the web build), and `bun test` per workspace (without `*.live.test.ts`). `scripts/test-workspaces.ts` finds the workspaces with tests, so CI tests a new workspace without an edit. | CI | Active |
| The compiled binary starts: `apps/server/scripts/smoke-binary.ts` builds it and starts it as the Docker image does. | CI | Active |
| API contract: every procedure has a one-line summary and an output schema, and the OpenAPI document builds with both. Real replies of a sandbox engine match their schemas. `exact<T>()` fails the build when an output schema differs from its domain type. | `packages/api/src/contract.test.ts` (CI), TypeScript | Active |

When a check exists, change its status to "Active". The scripts find the workspaces themselves, so a new workspace needs no list entry. Fix a violation, do not add an exception. If a rule is wrong, change this document first.

## 8. Known deviations

When code must break a rule for a while, add an entry here: the rule it breaks, the files, and the change that removes it. Remove the entry in the change that fixes it. Do not copy a deviation into new code. Each entry is listed in a check too, and that check fails once the deviation is gone.

- **`@nightshift/devices/testing` has no importer in another workspace** (every entry has an importer, section 3). Only the tests of `devices` use its fakes. Listed in `ENTRY_EXCEPTIONS` of `scripts/check-layers.ts`. Fix: a test of `api` or `daemon` uses `inMemoryHost` or `pairedReplicas`, or the entry goes and the fakes stay inside `devices`.
