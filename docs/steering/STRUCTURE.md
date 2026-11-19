# Night Shift Codebase Structure

> The rules for where code lives. Read this before you add a file, a folder or a package.
> When a rule changes, change it here and record the change in the ADR table of `TECH.md`.

Last updated: 2026-11-18

Night Shift is a **layered vertical codebase**.

- **Layered:** packages sit in layers. A package imports only from packages in a lower layer.
- **Vertical:** inside a package, code is grouped by domain (what it does), not by kind (what it is).
- **Rings:** inside a server package, a capability has three rings: `domain/`, `application/` and `adapters/` (section 9).

Code that changes together lives together. A boundary that is not enforced is not a boundary.

## 1. Layers

| Layer | Packages | May import (`@nightshift/*`) |
| --- | --- | --- |
| 0. Foundation | `config`, `refusal`, `semconv`, `time`, `db`, `flows`, `ui`, `ui-native` | Nothing. `ui` and `ui-native` import only themselves. Every workspace may import `config`, `refusal`, `semconv` and `time`. `config` holds no code. `refusal` is the one refusal type, `semconv` is the one list of telemetry names, and `time` is the one clock. All three import nothing of Night Shift. |
| 1. Insights | `insights` | `@nightshift/semconv` and `time`. It does not import `db`. |
| 1. Capabilities | `auth`, `agents` | `auth`: `db`. `agents`: `flows`. |
| 2. Core | `engine` | `db`, `flows`, `agents`, `auth` |
| 3. Core domains | `devices`, `notifications`, `telemetry` | Layer 2 and lower |
| 4. Surface | `api` | Layer 3 and lower |
| 5. Runtime | `daemon`, `client` | `daemon`: layer 4 and lower. `client`: only `api` (the `./client` entry, `import type`), `flows` (the root), `engine` (the `./run-status` entry) and `notifications` (the `./contract` entry). |
| 6. Apps | `server`, `desktop`, `web`, `mobile`, `insights` | See below |

The apps:

- `apps/server` imports the runtime and lower layers. It holds the dev entry and the CLI.
- `apps/desktop` imports only the runtime (`@nightshift/daemon`).
- `apps/web` imports only `@nightshift/client`, `@nightshift/flows` (the browser-safe root) and `@nightshift/ui`. It gets the API's types through `@nightshift/client`. It never imports or declares `api`, `engine`, `agents`, `auth` or `db`.
- `apps/mobile` imports only `@nightshift/client`, `@nightshift/flows` (the root) and `@nightshift/ui-native`. It never imports `@nightshift/ui` (the DOM components), `api`, `engine`, `agents`, `auth`, `db`, `devices`, `notifications` or `daemon`.
- `apps/insights` imports only `@nightshift/insights` and `@nightshift/ui`. It wires the admin UI, Better Auth, and the ingest listener.
- `@nightshift/client` sits in layer 5 because it reads the API's types. No runtime imports it, only the apps do. It uses no DOM, no React Native, and no Node or Bun API. React and TanStack Query are allowed.

Rules:

- Dependencies point down. A lower layer never knows a higher one.
- No package imports an app. An app is never a dependency.
- No cycles between packages. No cycles between the verticals of one workspace, type-only imports included. The only way back is a peer port (section 4).
- A workspace declares only the workspaces it imports. A dependency that no file imports comes out of `package.json`.
- When a lower layer must call a higher one, the lower layer declares a port (an interface). The higher layer implements it, and the composition root wires it.

## 2. What each package owns

One package is one bounded context. One domain has one home.

| Package | Owns | Does not own |
| --- | --- | --- |
| `config` | The shared TypeScript configuration (`tsconfig.base.json`). | Code. |
| `refusal` | The refusal type (`Refusal`): an error written for people, with what happened, how to fix it, and its kind (`invalid`, `signed-out`, `forbidden`, `not-found`, `conflict`, `unavailable`). Every package throws it when it refuses a person's request. Any other error is a failure, and a person sees its plain words (`FAILURE_MESSAGE`, `wordsFor`). It imports nothing. | How a surface answers it. The API gives each kind its status (`readable` in `api`). The peer protocol of `devices` keeps the codes older Devices know. |
| `time` | The clock. An instant is UTC milliseconds, and that is the only time Night Shift stores. Calendar math is date-fns in an explicit IANA zone (`in: tz(zone)`). Screens format with the viewer's zone (`formatTime` and the rest) and show the same instant in UTC on hover (`hoverTime`). Cron times are the `./cron` entry. `./testing` builds instants for tests (`utc`, `atLocal`). It imports no Night Shift package. | Cron lines as a schedule rule (those stay in `flows`). A screen's own sentence around a time. |
| `semconv` | The telemetry names (`ATTR`, `METRIC` and the rest) and the usage-event schemas. Weaver generates them from `packages/telemetry/registry`. It imports no Night Shift package. | The spans and metrics themselves (`telemetry`). |
| `insights` | The ingest rules, the Postgres schema and the admin queries. One `usage_event` table holds the common fields and `jsonb` for the other attributes. SQL views answer the usage numbers. It imports `@nightshift/semconv` and `@nightshift/time`. | The admin app (`apps/insights`). The usage export on the computer (`telemetry`). |
| `db` | The libsql client, the drizzle schema, migrations, the data directory. | The queries of a domain. Those live with the domain. |
| `flows` | The flow format: one file per node type (`nodes/`: its schema, its checks, and its definition `NodeDefinition` with every fact of the type that holds without a run. The files sit in a sub-vertical per family: `do/`, `decide/`, `shape/`, `hold/`, `compose/`. What the types share has its own sub-verticals: `names/`, `base/`, `profile/`, `harness/`, `definition/`, `cascade/`, `gate/`, `ask/`), the flow schema (`flow/schema/`), its migration (`flow/migrate/`), the walk from node to node (`flow/walk/`) and the one list of the node types (`flow/node/`: `NODE_DEFINITIONS`, which the facts of a node read), and the checks of a whole flow (`validate/`). `validate/` holds the template scope too: what a template may read, for the checks and the editor's suggestions. The shapes (`shapes/`): what an output field, an input, a variable or a flow output holds, as JSON Schema, a template path read into a shape, and the editor's shape model. The Value presets (`presets/`): Filter, Pick fields, Sort, Limit and Remove duplicates, each the expression and output schema of a Value by rule, made from a list and the shape of its items. Templates, rules and variables (`template/`: `refs/` for the `{{name.path}}` references, `rule/` for JSONata). List sources (`lists/`, `recipes/`). The pure edits of a draft (`draft/`: new nodes and outcome edits in `nodes/`, graph and Section edits in `graph/`, renames and the name clash of the one namespace in `names/`, Make subflow in `subflow/`, the draft check and the place a flow is checked in (`FlowPlace`) in `check/`, which every door that checks a flow fills). The built-in run policy (`DEFAULT_POLICY`), which the engine's settings fall back to. No I/O: flows are Night Shift data ([ADR 2](../adr/0002-flows-are-night-shift-data.md)), and the engine keeps them. Schedules and agent profiles, because a flow references them. The harness catalog (`harnesses/`): what a person sees of each built-in harness, browser-safe, for the web app and `agents`. The layout of the knowledge folder (`kits/knowledge/layout/layout.ts`): the names of what Night Shift keeps there and which folders are its own. It imports nothing. The kits generate their shell from it, and the engine and the web app import it. The Knowledge sources (`kits/knowledge/source-kits.ts`): one declaration per source yields its kit and its kind, so the page and the readiness check read the same list. | Running a flow. UI copy: the editor passes its own words to `checkDraft`. The label and the one line of a Knowledge source stay in its declaration. |
| `ui` | shadcn/ui components and tokens. See `AGENTS.md`. | Anything domain-specific. |
| `ui-native` | React Native Reusables components (shadcn for React Native) and their tokens for `apps/mobile`, on Uniwind. Installed with the React Native Reusables CLI. See `AGENTS.md`. | Anything domain-specific. The DOM components (those are `ui`). |
| `auth` | Identity and access on Better Auth: login, two-factor, pairing, device keys, Spaces, members, roles, the access of a request and of a synced document. The auth tables. What Better Auth refuses for a Person's request, as a `Refusal` in Night Shift's words (`access/auth-refusals.ts`). | Device rows. |
| `agents` | Harness sessions, one harness adapter per harness, decider providers, MCP and CLI tools, pricing, skills. | Run order, retries, gates. |
| `engine` | The run engine: compile a flow to a graph, walk it, run policy, gates, the event log. The log (`log/`) is made of sub-verticals, and their imports point one way: the events and the words of their payloads (`events/`, with `step/` and `run/` in it), the run state (`state/`), a step's transcript (`transcript/`), the run's row (`run-row/`), the run log (`run-log/`), the facts of no run (`space-facts/`) and the run history that the exchange copies (`history/`). The run state (`log/state/run-state.ts`) is one fold of a run's log (`log/state/fold-run.ts`, with a file for the events of a step and one for those of a session). Its status, its end, its open Gates and its sleep are fields of it, folded once, so no reader derives them again. The run log (`RunLog`) is the one door to a run's facts, its row and the files of its steps on this computer. It writes the rows an event of this Walker implies with the event (`log/run-log/event-rows.ts`): the step row of `StepStarted`, the session row of `SessionStarted`, its harness id, the kept values and the node memory of `StepEnded`. The memory of Since last run nodes (`memory/`): what each node saw, read by its step and saved with its `StepEnded`. The walk (`graph/`) is made of sub-verticals, and their imports point one way: the state of the compiled graph (`state/`, `branches/`, `position/`), its Checkpoints (`checkpoints/`), the transcript recorders (`recorders/`), what a step may touch (`context/`), the run policy (`policy/`), the data of a step (`data/`), where a visit goes next (`route/`), the cascade (`cascade/`), one step (`step/`), the compile (`compile/`), the node kinds by family (`nodes/`: `agent/`, `do/`, `decide/`, `shape/`, `hold/`, `compose/`) and the runner with its Turns (`runner/`). What a step may touch on this computer is one object (`graph/context/context.ts`: `StepShared`), made once by `createEngine`. A Thread adds the run's own to it (`StepContext`). No node reads the database or a folder. This computer as a Device (`device/local.ts`: `localDevice`) takes its configuration as the stores of its Device document (connections and secrets, CLI tools, Agent Profiles) and its harnesses. The run read model. It includes the run as monitoring reads it (`read/run-trace.ts`, `Engine.runTrace`) and the Needs-you inbox (`read/inbox.ts`). The inbox holds the open Gates of every Space a Person is in, the oldest first, with one order for a tie. Both apps sort the reply into the Gate queue (`gateOrder` of `client`, ADR 29). It also says which answers the lock screen takes. What a person does to a run (`run/actions.ts`: stop, answer a Gate, send a Signal, move, resume, restart a step, run again). `SpaceEngine.act` takes it in the person's words, or as the Command that carried it to this Walker, and acts here or on the Walker elsewhere through the `Relay`. The Command has one home (`contract/command.ts`): the kinds the schema stores, the actions that travel as them, the permission each needs (`permissionOf`, which the API, the Host and the Walker check) and its wire schema (`runCommandSchema`). Which of those a run allows (`run-status/`: one rule with its words, for the apps too, which imports only the refusal type). `RunStatus` has that one home: the log names it, and does not export it. The share of ended runs that finished (`finishedShare`, in `run-status/` for the same reason). Projects and worktrees. The run folders (`run-folders/`): the folder a run of a project without a folder works in, one per run on each Device of its steps, in the data folder (ADR 22). It also lists the files in it and gives one of them, and it never follows a link. The Device reads a report file with the same rule (`device/read-file.ts`). The Yjs documents this Replica syncs, by name (`documents/`: `SyncedDocuments`). It opens each document once, tells its kind and its Space, and lists the documents of a Space. Each document is a row of the `ydoc` table. The typed views stay in their verticals: the flow, knowledge and Space documents, the Device copies and the Device document. The flows and schedules of the projects, in one module (`flows/project-flows.ts`: `ProjectFlows`). The engine and the Devices (`Engine.flows`) read and change them only through it: reads, saves, Flow revisions, schedules, notices, the upgrade to a newer format, and the merge of one Project's flows into another's. It knows Projects, not Spaces. Their Yjs encoding (`flows/flow-document.ts`, the only file that knows it): `flows:<id>` for the flows, schedules and notices, `flows-history:<id>` for each Flow revision. Outside that file, a flow document is the two documents a Link syncs. What a Person does with the flows of a Space (`flows/space-flows.ts`: `SpaceEngine.flows`). It checks the project's Space for every verb, in one place: list, read, save and remove flows, their notices, see and restore their Flow revisions, export, import, and copy them into another project. The import on upgrade (`flows/import.ts`): each Clone's `.nightshift/` folder, once. It has its own reader of the folder (`flows/legacy-folder.ts`) and of the old project profiles (`flows/legacy-profiles.ts`). `flows/clone-imports.ts` runs it at the engine's start and when a person adds a Clone. The cleanup of what ended runs left on this computer (`cleanup/`): the scheduled sweep that removes a run's worktree and local branches a day after the run ended, keeps the work that is only here under kept refs first, and deletes those `cleanUpAfterDays` after the run ended (ADR 28). It also has the files of a run folder for the run page, with their cleanup date, and the sweep of the run folders, which removes them after `cleanUpAfterDays` with no git check. The Secret scope rule (`device-config/secret-scopes.ts`: `secretScopes`). It is the one owner of which scopes a use of `${NAME}` reads where, in their order (ADR 13, ADR 18), and of the words of a move's warning (`takenOverSecrets`, ADR 17). The connection store applies it when it resolves values. The facts come to it: the run from Placement, "under an Offer" from the Offer admission of `devices` on the call it admits, "Be a Host" from the settings store. The stores of each scope stay its adapters: the Personal and Project ports that `devices` implements, the keychain, the environment. The device-config document and the edits that keep it whole (`device-config/edits.ts`). A profile names only connections and CLI tools that exist. A rename or a removal changes the profiles that name it. What uses each piece of it, and each secret of a project and of the Space (`flows/config-use.ts`: `createConfigUse`). It reads the Space's flows itself and knows this Device. One rule says what uses a secret, for every Secrets list. The API only asks it. The dashboard (`dashboard/`). Its numbers come from the runs of one project or of several Spaces (`projectDashboard`, `spacesDashboard`). It also has one flow's health (`summarizeFlow`), the days Flow health covers (`healthNights` of the summary, which the screens read from the reply), and the reader's time zone (`isTimeZone`). The words it shares with its callers and the Devices (`contract/`): `Actor`, `MemberChange`, `StartRunInput` and its schema, the Command (`command.ts`), `Placement`, `OwnDevice`, and the ports a vertical asks of the devices (`DeviceDirectory`, `Relay` with `HostUnreachableError`, `OffersPort`). `contract/` imports no other vertical, so every vertical names those types without a cycle. Placement (`placement/`). It makes the Run plan a run starts with (`planNodes`, `device-order.ts`). It holds the one check that a Device can take a step (`fit.ts`). It reads the plan for the walk (`createPlacement`): the Device of a step now, a Device of the run by id, and the move of a step to a backup when its Device is offline (ADR 17). The port it asks of the devices is `PlacementPort`. The engine's own interface (`Engine`, `SpaceEngine`, `EngineOptions`) and the port it walks with (`Peers`) sit with `createEngine` in `run/`. The Space move (`run/projects-move.ts`, `Engine.moveProjects`): Projects to another Space as one operation, for a person's move, the merge and the split. Every path that makes a run active asks its hold (`run/start-holds.ts`). The rows of higher packages that move with the runs come through its port `MoveRows` (`EngineOptions.moveRows`): the Commands from `devices` (`commandMoves`), the deliveries from `notifications` (`deliveryMoves`). The Space archive (`archive/`: `SpaceArchive`, one per Replica). It keeps the walk files of runs walked elsewhere, with their stamps, and the knowledge content by hash. It owns their layout and the write of a whole file (`writeWhole`). A read takes the copy here, else the Host's copy, and keeps it. A put goes to the Replica that keeps the Space. The callers decide when. Its Hosts come through its port `ArchiveHost`, which the relay of `devices` implements. A project's knowledge on this Device (`knowledge/`: `createKnowledge`, `Knowledge`), one module behind one door: a step's Device, the API and the daemon use only that interface. Its sources read the Space through the port `SourcesSpace`. The look back at runs that ended (`createRunLearnings`, ADR 37) reads the runs through its own port `RunsToLearnFrom` and writes only through that interface. Its page readers (`knowledge/readers/`, ADR 39): one port (`PageReader`) with Night Shift's own reader, Jina Reader and Firecrawl, the step's reader on a loopback listener, and the quick look at a link. Where a web request of this computer may go (`web-access/`: `checkHost`), for a Web request step and for the page readers. The schedules of the projects (`schedules/`) are a slice with rings (section 9): `wireSchedules` binds its use cases, and `createEngine` fills its other ports. | Other Devices and Hosts. The engine declares the port it walks with (`Peers`, in `run/peers.ts`), and `devices` implements it. The Device rows (`device`, `host_space`). The engine reads this computer's Device, the names of Devices and the Spaces a Host keeps through `DeviceDirectory` (`contract/directory.ts`), which `devices` implements too. Process concerns such as the lease and OS dialogs (in `daemon`). |
| `devices` | This computer among other Devices and Hosts. The engine's `Peers` port (`createPeerEngine`) and `DeviceDirectory` port (`deviceDirectory`). This computer's own Device row and its owner (`registry/self-device.ts`). The device registry and Offers. The Devices Placement chooses among (`placement/`): a Person's Devices in a Space, from the registry, the Host or the copies. It implements the engine's `PlacementPort` over them. The Offer admission (`offers/admission.ts`) holds every check of a call of a run on this computer, by either path, and one slot map per Offer (`offers/offer-use.ts`). The pure checks of one call are in `offers/offered-call.ts`. The exchange of run history (`RunHistoryExchange`), over the engine's Space archive. It reads rows by cursor, ingests them in one transaction, reads every consequence from the log, and applies Commands once (`SpaceEngine.act` takes the Command as it came). The queue of Commands a Host keeps (`exchange/commands.ts`). The Device's half (`DeviceExchange`) and the Host's half (`HostExchange`) both go through it. The Links to Hosts and pairing, this computer as a Host, the work relay. The Link translates every answer of a Host into this computer's words (`links/from-host.ts`). The procedures it hands out, and `Link.call` with its deadline, give a `Refusal` with its kind, `HostUnreachableError`, `OlderHostError` or `NotPairedError`. No other file reads the wire's codes. A caller adds only its own sentence for a Host of an older version. The peer protocol: the procedures a Device calls on its Host (`link`, `pairing`, `sync`, `archive`, and the work relay under `devices`). `contract/` writes them once as an oRPC contract (`hostContract`): each procedure's input and output schemas, the Device key permission it needs, and its refusals. It is made of sub-verticals, one for each part of the protocol: `links/`, `sync/`, `archive/`, `secrets/` and `work/`. Each holds its wire schemas and its procedures (`procedures.ts`). `procedure/` holds what every procedure starts from. `host-contract.ts` is the table over them. It also holds the wire schemas and types, `HostRelay` (with the engine's `ArchiveHost`) and the `Caller`: a Device key as the Host admitted it. Its client type is `HostClient`. `host/keyed-call.ts` admits a keyed call once, from the contract's meta (`Devices.admit` gives the `Caller`), and writes every error in the codes older Devices know (`readable`). `host/router.ts` is the table that implements the contract (`hostRouter`), over `HostExchange` and the Host, whose procedures take the Caller. `contract/` imports no other vertical, so every vertical names those types without a cycle. The API's ports `Devices`, `HostExchange` and `Offers`. The devices runtime (`wire.ts`, `startDevices`): the one call the daemon makes. It builds the engine with its peers and every devices piece. It owns their `bun --hot` reload in one kept slot (`handover.ts`, beside it). What it takes and gives is in `devices-runtime.ts`. The old runtime stops its Links and presence sweep and disposes its engine. The new one takes over the work hub, the applied commands, the calls it serves for a Host and the Offers in use. | The execution port (`Device`) and this computer as a Device (`localDevice`). Those stay in `engine`. The Command's kinds, permission and wire shape (`contract/command.ts` in `engine`). The procedures a Person calls (the Devices page, approving a pairing, Offers, the phones, `nightshift join`). Those are `api`. || `notifications` | The notifier (`notifier/`). It reads the landed facts of this Replica (`Engine.onLandedFacts`: what each run event that lands means, derived in the engine). It decides whom to tell about a new Gate, a finished run, a failed run and a step that waits for an offline Device. The notification contract (`contract/`): the notification keys (`runId:stepId` for a Gate, `runId:end:<seq>` for a run's end), the push categories, channels, buttons and data, and where a tap goes. `contract/` imports nothing, so every screen can read it. The client re-exports it. The rules: answer once, clear everywhere, the active screen first, one sender per Space, quiet hours, once per key, no content in a push. The Person's notification settings (`settings/`, with `adoptComputerSwitches`, the one-time copy of a computer's three old notification switches). The push targets (`targets/`: each browser, phone and desktop app). What was sent, held and withdrawn (`deliveries/`). The channels behind one port, `NotificationChannel` (`channels/`), each with a fake. The in-app stream. Web Push (`web-push.ts` on the `web-push` library, with the VAPID keys that the sending daemon makes once, `vapid-keys.ts`). Expo Push (`expo.ts` on `expo-server-sdk`, with its receipts). The desktop notification (`desktop/`): its channel, the OS port `DesktopNotifier` and the window port `DesktopWindow`. `DesktopNotifier` is Electrobun's notification from the desktop app, else `systemDesktopNotifier` (`terminal-notifier` or `osascript`, `notify-send`). Its tables. `wire.ts` composes them (`createNotifications`). See `docs/research/mobile.md`. | The run log and the Gates (those are `engine`). The Person's session (that is `auth`). The in-app stream procedure (that is `api`, which calls the notifier). |
| `telemetry` | The export to monitoring. It is opt-in ("Send runs to your monitoring", off by default). It sends the runs this computer walks as OpenTelemetry spans and metrics. A projection of the landed facts (`runs/`). Each fact that ends a step or a run reads `Engine.runTrace` and writes that part, never a second record. Every attribute, span and metric name comes from `@nightshift/semconv` and is re-exported by `conventions/`. That module also has the ids of a run's spans, made from the run's ids, so any process can name them. The tracer and meter providers over OTLP/HTTP (`otlp/`), started and stopped as one, nothing registered globally. The environment of a Claude Code session of a step while the export is on (`sessions/`): its own telemetry under the step's span, `TRACEPARENT`, no content. `wire.ts` composes them (`createTelemetry`). It reads the settings store and follows its changes. It reads the `${NAME}` references of the headers through the secrets and follows their changes too. The anonymous usage export (`usage/`) is separate: OTLP logs of the allowlisted events, from an outbox in the local database, on when this computer sends usage. | The run log and what a run means (`engine`: `runTrace`, the landed facts). The settings and their shape, the headers included (`engine`, `device-config/settings.ts`). The secrets (`engine`, `device-config/connections.ts`). |
| `api` | The oRPC surface: procedures per domain, middleware, the router type the web app consumes. The one rule for errors at its seam (`readable` in `procedures.ts`). An oRPC error passes on as it is (a declared one too). A `Refusal` becomes the status of its kind, with its words. `HostUnreachableError` becomes `HOST_UNREACHABLE` (503). Any other error is a failure: a 500 with plain words, logged with the procedure's path. A streaming procedure passes its errors through the same rule (`streamed`). A procedure keyed by a run id finds the run's Space once (`runProcedure` in `runs/`). A procedure keyed by a project id checks the project is the Space's once (`projectProcedure` in `projects/`). The owner of this computer is read in one place (`ownsThisComputer`). Every procedure declares an input schema, an output schema and a one-line summary. That makes the router the one source for the web client, OpenAPI and any agent tool surface (MCP). It mounts the peer protocol of `devices` (`hostRouter`) at its paths (`devices/peer.ts`), and gives it a Person's phones from the notifier. | Domain logic. A procedure validates, checks access and calls one domain function. The peer protocol a Device calls on its Host. That is `devices`: a wire protocol between daemons, not the product API. |
| `daemon` | Boot and runtime: `createDaemon(env)` (the composition root), `startDaemon()` (the one boot sequence), the Hono app and its routes, the lease, health, the document sync transport, signals. The hot-reload slots (`hotSlots`): each slot is kept, replaced or handed over, and stops with the daemon. The harness table of this computer, OS dialogs, and "Keep this computer awake" (`keep-awake/`: the OS's sleep lock behind a port, `caffeinate` or `systemd-inhibit`). The export to monitoring of this computer: `createTelemetry` gets the settings store and the secrets before the local Device, which asks it for a session's environment. It follows the engine once the engine exists. `telemetry/` moves headers kept the old way (the `nightshift-telemetry` value store) into the setting and the secrets at start. The notifier of this computer (`notifications/`). `wireNotifications` gives `createNotifications` its channels and this computer's desktop. It registers the desktop as its owner's screen. On a settings save, it gives the old notification switches to the owner. It starts `devices` with one call (`startDevices`), which gives it the engine and the API's ports and hands itself over on a hot reload. It keeps its relay across hot reloads. | Domain logic. The access policy of a synced document (that is `documentAccess` in `auth`). |
| `client` | Client logic that `apps/web` and `apps/mobile` share. Browser- and React-Native-safe. The oRPC query option factories with their query keys and polling rules. A mutation with no rule of its own is the app's `orpc` one, used as it is. The run-stream reconnect loop (`afterSeq` and dedup, a stop on `NOT_FOUND`). The live cache (`live/`): the one follower of a Host for both apps. `useFollowHost` follows the notifications stream and reconnects. It reads again what each item changes, including a synced document, and shows a notice for an item with `alert`. It closes the notifications of Gates that no longer wait, through the app's adapter of `ShownNotifications`. `useAnswerGate` applies the one Gate refusal rule. `useRunActed` reads a run again after a person acts on it, in the burst of the stream. One table (`changes/`) says what each change makes stale and what each save route writes. The live cache reads it after a stream item and after each save that succeeds. The query client keeps the reads a synced document holds fresh until it changes. `useChanged` reads again what a job that ended, or a save through the client, changed. `useLiveRun` follows one run's stream in batches and keeps its steps, status and entries. Keep and Delete of a learning (`knowledge/use-settle.ts`, `useSettleLearnings`), with what they read again and what stays out of a list meanwhile. The view types derived from the API. The notify rules of the in-app stream. Which actions a run allows, as the engine rules them (`runs/status/actions.ts` passes on `@nightshift/engine/run-status`), and the share of ended runs that finished (`runs/status/share.ts`). The answer to a Gate (`gates/answer/answer.ts`): `answerGate` turns a refusal of `gates.resolve` into an outcome, and `gateRefusalText` gives its words. The Gate queue (`gates/inbox/queue.ts`): the urgency words, the one queue order of both apps (urgency, then the first deadline, then the oldest), and `mayAnswer`. When an answer may go (`maySend`). The brief as parts (`gates/question/brief.ts`). Where a choice leads, what an answer does and when to confirm (`gates/answer/routes.ts`). The push contract as the screens read it (`notifications/push.ts`). It re-exports `@nightshift/notifications/contract` and adds `staleGates`, the rule that clears the notification of a Gate that no longer waits. The words and rules both apps show for one thing: a cost, when a run started, how long ago, a computer's system, a phone delay, when a Gate's deadline falls, a step's outcome, whether a listed flow can start (`canStart`). The time now that keeps "how long ago" current (`useNow`). | The oRPC client instance and its transport. Each app makes its own: `fetch` on the web, `expo/fetch` on the phone. Components. Domain rules of `flows` or the engine. |
| `apps/server` | The dev entry (`src/main.ts`, run by `bun --hot`) with `src/hot-preload.ts`. The preload keeps one Yjs per process, so the documents the daemon keeps across a reload use the same Yjs as the new code. The CLI (`src/features/cli/`, entry `src/cli.ts`), the binary build (`scripts/`), the env schema, and the tests that start whole daemons as processes (`test/`). | Domain logic. |
| `apps/desktop` | Tray, window, updates, watchdog. | Any logic of the daemon. |
| `apps/web` | The UI. One vertical per product area. | Rules that the engine or `flows` already has. |
| `apps/mobile` | The phone app on Expo (Expo Router): a Person's client of a Host that reads and acts. One vertical per product area. | Flow and schedule editing. A Replica, Yjs or libsql. Logic that `client` or a package has. |
| `apps/insights` | The admin UI, Better Auth, and the ingest listener. One Bun process. | Ingest rules, the Postgres schema, and the usage queries. Those stay in `insights`. |

### Tables have owners

Each table has one owning package. Another package reads or writes that table only through the owner's functions.

Examples:

- The engine asks `@nightshift/auth` for the members of a Space. It does not query `member`.
- The exchange of `@nightshift/devices` copies run history between Replicas through the engine's `RunHistory` (`PeerContext.history`). It does not query `run`, `step`, `agent_session` or `event`. What the membership needs done to them is an engine operation too (`Engine.moveProjects`, `Engine.forgetSpace`).
- The Projects and their Clones are the engine's as well. `@nightshift/devices` reads and records them through the engine's Projects module (`PeerContext.projects`: `ofSpace`, `matching`, `clones`, `clonePath`, `recordClone`, `take`). It reads the Device documents a Host keeps through `PeerContext.keptDevice`. It never passes its database handle to an engine helper.

The fields of an event that name a path on its Walker's disk are listed once, like those that name a Person (`PATH_FIELDS` beside `PERSON_FIELDS`, engine `log/`).

The schema is in `packages/db/src/schema/`, one file per owner: `auth.ts`, `devices.ts`, `projects.ts`, `runs.ts`, `device-config.ts`, `engine.ts`, `assistant.ts`, `daemon.ts` and `notifications.ts`. A comment above each group of tables names the owning package and vertical. `schema/index.ts` lists every file with its owner. `auth:generate` writes `auth.ts`, so only the index names its owner. Put a new table in the file of its owner. When a table moves to another file, its migrations stay the same: `drizzle-kit generate` must report no changes.

Test fixtures and the fakes of `./testing` may set up and read any table. Example: the engine's `aloneDirectory` reads the `device` rows that a test adds.

### Ports for external I/O

Every call to `git`, `gh`, a harness CLI, `osascript` or another OS program goes through a port. The port is an interface in the package that needs it. The adapter implements it. Tests use a fake adapter. In a capability of a server package, the port, its adapters and their tests have a fixed place and fixed names (section 9).

## 3. Public surfaces

Each package lists its public entry points in `package.json` `exports`.

- **No wildcard exports** (`"./*"`). Every entry point is named on purpose.
- Exception: `@nightshift/ui` keeps `./components/*`, `./hooks/*` and `./lib/*`. That is the shadcn layout, and `components.json` depends on it. `@nightshift/ui-native` keeps `./components/ui/*`, `./hooks/*` and `./lib/*` for the same reason: the React Native Reusables CLI puts its components in `components/ui/`.
- **An entry points at a barrel or a top-level file:** `src/index.ts`, a file directly in `src/` (`src/client.ts`), or a barrel one folder down (`src/migrate/index.ts`, `src/testing/index.ts`). An entry that must point deeper is a light entry. It is listed with its reason in `LIGHT_ENTRIES` of `scripts/check-layers.ts`. The light entries today:
  - `@nightshift/agents/harness-facts`. The barrel of harnesses brings every harness and the session, which are not browser-safe.
  - `@nightshift/engine/device-config` and `@nightshift/engine/projects`, which point at `entry.ts` in their vertical. The barrel also serves the engine's other verticals (the Space move's batch, the run worktrees). So the entry carries only the names another workspace imports, and rule (m) of `scripts/check-verticals.ts` checks each of them.
  - `@nightshift/devices/testing`, for the same reason: the barrel of its test helpers serves its own tests.
- **Every entry, and every name on it, has an importer in the production code of another workspace.** A test counts only for a `./testing` entry. An entry that nobody imports comes out of `exports`. A name that only tests of other workspaces use moves to the package's `./testing`. A name that only the package itself uses comes off the entry. For an entry that is also a vertical's barrel, a production file of the package outside that vertical counts too. The root `index.ts` counts for the names it passes on that are used in turn.
- **A type may also stay when a used name's declaration writes it.** Another package's emitted declaration can name a type that its source never imports. Example: the API's `appRouter` mounts `hostRouter`, so the emitted type of `appRouter` names `HostPeerContext` and `HostProcedureMeta`. Without them on the `devices` root, `tsc` fails with TS2883. So a type without an importer passes when the declaration of a used name on the same entry writes it, in turn. A declaration writes a type's text, a function's parameters and return type (its body too when it has no return type), and a constant's type or its value. The check reads what the declarations write, not what TypeScript infers. When `tsc` needs a type that no declaration writes, write it (a return type).
- **No `export *`.** Every entry and barrel names what it exports. The one exception is the drizzle schema index (`@nightshift/db/schema`): drizzle reads every table from it.
- `index.ts` exports what consumers use. It is not a barrel of every file.
- Test helpers, fakes and fixtures are public only through `./testing`. Production code never imports `./testing`. A `./testing` entry may also pass on a production name that only tests of other workspaces use (`defaultDeciderModel`, `OPEN_HOST`). A package keeps test helpers that only its own tests use in `src/testing/`, without an entry. When another workspace's test needs one of them, the `./testing` entry is a light entry that carries only that name (`devices`).
- An entry that `client` reads for the web app and the phone app is type-only and browser-safe (`@nightshift/api/client`). The apps read the API types through `client`.

The entries today:

| Package | Entries |
| --- | --- |
| `agents` | `.`, `./harness-facts`, `./pricing`, `./tools` (the MCP client the Tool node calls, and Night Shift's knowledge tools with the Session brief), `./types` (the port barrel: the harness contract's types and its shell quoting), `./testing` (fakes, `fixturePath(name)`, `defaultDeciderModel` for a test's own decider). The engine uses the four light entries, because the root brings every harness and decider (their TanStack packages load on first use). `./harness-facts` is browser-safe. |
| `api` | `.` (`appRouter` and its types, and `runAccess`: the access ladder of a run for a Person, with the refusals the procedures give, for the daemon's run file routes), `./client` (types only, for `client`, which passes them on to `apps/web` and `apps/mobile`), `./context` (`Context`: the request's `access` from auth, and the daemon's `Services`), `./testing` (`testContext`, `accessAs`) |
| `auth` | `.`, `./testing` (`createAuthSandbox`, the second factor of a Person, and the Host policies a test sets or expects: `OPEN_HOST`, `TWO_FACTOR_REQUIRED`) |
| `client` | `.` (`createApiClient`, `createQueryUtils`, the `create<Vertical>Queries` factories, `useFollowHost`, `useLiveRun`, `useAnswerGate`, the seam `ShownNotifications` (with `Notice`, `ListedNotification`), `EntryFold`, `HostApi`, `mergeSteps`, `answerGate` and `gateRefusalText`, where one run is now and what it needs (`runNow`: its status with what came live, the actions it allows and why not by the rule of `@nightshift/engine/run-status`, the Gate it waits at, and its notice in parts a screen draws, for a run's screen and for a list row that offers an action), the name of the device that walks a run (`walkerName`), the notify rules, the push contract (`PUSH_CATEGORY`, `PUSH_ANDROID_CHANNEL`, `PUSH_ACTION`, `PushData`, `pushDataOf`, `withdrawKeyOf`, `PushRoute`, `routeOf`, `webPathOf`, and the rule that finds what a read of the open Gates shows is over, `staleGates` with `ReadGate`), the shared formatters (`formatCost`, `formatKnownCost`, `costLabel`, `usageLabel`, `whenLabel`, `agoLabel`, `platformName`, `PHONE_DELAYS`, `phoneDelayLabel`, `deadlineText`, `deadlineWhen`, `useNow`, the clock `formatTime`, `formatDateTime`, `formatDayTime`, `formatRelative`, `formatLongDay`, `hoverTime`, `iso`, `now`), the shared words (`runStatusLabel`, `stepOutcomeLabel`), where a run is (`statusOf`: its word, its look and the group it counts in, one table for every list, chip and tile, with `groupStatuses` and `groupCounts`), the shared rules (`canStart`), the view types), `./testing` (`gateKey`, `staleGates`: the push contract's Gate key and closed-Gate rule, for the test of the web app's service worker, which cannot import them) |
| `db` | `.`, `./schema`, `./data-dir`, `./migrate` |
| `devices` | `.` (with `hostRouter`: the peer protocol, for the API to mount, and `HostClient`: how the daemon reaches its Hosts), `./testing` (`hostInMemory`: a Replica as a Host in this process, for the daemon's test that pairs with it. A light entry, `testing/entry.ts`). Its other test helpers stay in `src/testing/` behind the barrel, because only its own tests use them: `withPeers`, `inMemoryHost` (the Host's own router in memory, behind `HostClient`), `pairedReplicas` (a Host and its paired Device in one process). |
| `daemon` | `.` (`startDaemon`, the CLI's and the desktop app's helpers: `prepareDaemonEnv`, `checkHealth`, `chatRun` (a run as the authoring tools read it, for `nightshift mcp`), `DEFAULT_PORT`, `DESKTOP_PORT`, the web UI handler, the desktop types `DesktopScreen`, `DesktopNotifier`, `DesktopWindow`) |
| `engine` | `.` (`createEngine`, `Engine` and `SpaceEngine` with their ports and the contract with `devices`, the run and flow views, the dashboards, the synced documents), `./agent-setup` (the guided setup of an agent CLI on this computer, ADR 25: `createAgentSetup` for the daemon, its types for the API, and `putAgentBinsOnPath` for `prepareDaemonEnv`. Then the setup of a decider: `createDeciderSetup` and its types), `./device-config` (this computer's Device document: settings, connections and secrets, CLI tools, Agent Profiles, the Device copies. A light entry, `device-config/entry.ts`), `./projects` (the Space documents with their Members and Device names, `PROJECT_NOT_FOUND`, `clonePathOf` for the daemon's Device before the engine exists, the git setup of a project folder, GitHub clones, project copies. A light entry, `projects/entry.ts`. What the peers do to Projects and Clones is on `PeerContext.projects`, not here), `./run-status` (the run's status and the actions it allows: `runActions`, `whyNot`, `RunRefusal`, a `Refusal` of the kind its rule is, and the report a run ended with: `runReport`. It imports only `@nightshift/refusal`, for `client` and `nightshift mcp`), `./testing` (with the stores and readers only tests build: the Device-document store factories, `createProjectFlows`, `openRunBundle`) |
| `flows` | `.`, `./json-schema` (`dataProblem`, `schemaProblem`, `outputDataProblem`: the one JSON Schema check, with ajv. The engine judges a step's data with it, and the report tool of `agents` checks an agent's `data` with it, so the agent can fix the data in its session. Not on the root, so ajv stays off the web app and the phone app), `./testing` (`commandNode`: a Command node with the id and position a test chooses, `FlowInput`: a flow before the schema fills in its defaults) |
| `telemetry` | `.` (`createTelemetry`, `Telemetry`) |
| `semconv` | `.` (`ATTR`, `METRIC`, `OPERATION`, `PROVIDER`, `ERROR_TYPE`, `SPAN`, `TOKEN_MODALITY`, `SERVICE_NAME`, `USAGE_EVENT`, `RETIRED_USAGE_EVENT`, `usageEventSchema`, `REGISTRY`. Generated from the Weaver registry. It imports no Night Shift package.) |
| `insights` | `.` (`createInsights`, `migrateInsights`, `ingestLogs`, `INGEST_RULE`, `overview`, `funnel`, `days`, `feedback`, `ladders`, `mix`, `retention`, `publicNumbers`, and the result types those functions return) |
| `refusal` | `.` (`Refusal`, `RefusalKind`, `FAILURE_MESSAGE`, `wordsFor`, from `src/refusal.ts`. It imports nothing.) |
| `time` | `.` (instants, the viewer's clock, the UTC hover), `./cron` (the next and previous time of a cron line, so croner stays off the phone), `./testing` (`utc`, `atLocal`) |
| `notifications` | `.` (`createNotifications`, `createInAppChannel`, `createExpoChannel`, `engineRunEvents`, `oneSenderPerSpace`, `createDesktopChannel`, `systemDesktopNotifier`, the settings and push target schemas, the channel port `NotificationChannel`, the Expo port `ExpoClient`, the desktop ports `DesktopNotifier` and `DesktopWindow`), `./contract` (the notification contract: keys, push data, where a tap goes. It imports nothing, for `client`), `./testing` (`fakeRunEvents`, `fakeWebPushSender`, `fakeVapidKeys`) |
| `ui` | `./components/*`, `./hooks/*`, `./lib/*`, `./globals.css` |
| `ui-native` | `./components/ui/*`, `./hooks/*` (no hook yet: the CLI's `hooks` alias in `components.json` puts one there), `./lib/*` (`lib/theme`: the theme colors in hex, the run status colors too, for JavaScript and for the widgets), `./global.css` (the theme tokens, for Uniwind) |

- A consumer imports a package by its name and a listed entry. Never by a relative path into another package (`../../packages/agents/src/...`).

## 4. Verticals

Every app and every package except `ui`, `ui-native` and `config` is cut into verticals. The model is the one yapyap uses.

### What a vertical is

- A vertical is a folder named with a domain word from `docs/glossary.md`: `runs/`, `gates/`, `schedules/`, `projects/`.
- Its `index.ts` is a barrel. The barrel is the **only** public surface of the vertical. A barrel holds only import and export statements. So does a package's root `index.ts`. Code goes in a file of the vertical.
- Code outside the vertical imports from the barrel only. A deep import into another vertical (`features/runs/list/run-list`) is an error.
- Inside the vertical, code uses relative imports and may reach any file.
- A vertical holds everything about its domain: components, hooks, query options, types, utilities, constants and tests.
- **No kind folder inside a vertical, at any depth (V7).** No folder named `components`, `hooks`, `lib`, `types`, `queries` or `mutations`. The names `utils`, `helpers`, `common` and `misc` fail as catch-all names (below). A small vertical stays flat. A big vertical splits into sub-verticals by sub-domain (below). A capability of a server package has only the ring folders (section 9).
- Every name on a barrel has an importer outside the vertical. A name that nobody imports comes off the barrel.
- Every source file of a vertical has a production importer in its workspace. A file that only its test imports is not used: remove it with its test.

### The capability map

`scripts/capabilities.ts` names every vertical of every checked workspace, and says what it is. It is typed data, not a document. `scripts/check-capabilities.ts` reads it. A vertical is one of three kinds:

- **A capability** is a product area. It holds the rules or the data of one thing a person meets in Night Shift. Its name is a word of `docs/glossary.md`, in the folder form: `runs`, `gates`, `flows`. The areas of the Insights admin have their own table, because the glossary does not name them.
- **A mechanism** is shared machinery. It carries, stores, formats or connects for the capabilities. It decides nothing about a product area. Its name is its folder name. A word of the glossary does not make a vertical a capability: the run log, the Space archive and a Lease are mechanisms. An app's `shared/<name>` piece is a mechanism.
- **The wiring** is the piece of a workspace that composes its capabilities. A workspace has at most one. Where it sits:
  - In an app it is `shared/shell`, when that shell imports a feature: the web app and the phone app have one. A shell that imports no feature is a mechanism (the Insights admin). An app that composes in its entry files has no wiring piece (`apps/desktop`, `apps/server`).
  - In a package without rings it is one vertical that only the entry files of the package import: `live` of `packages/client`. Its work is the composition: its rules say how the capabilities work together. A vertical that could take what it needs as arguments is a mechanism.
  - A server package (section 9) has none. It composes its slices in a `wire.ts` outside the verticals.

The rules:

- **V1: one map, one name.** Every vertical on disk is on the map, and every entry of the map is on disk. A capability has the same folder name in every workspace that holds a part of it. Two verticals of one workspace with one capability become one vertical with sub-verticals. A mechanism in a package or in `features/` never takes the name of a capability.
- **V2: the direction.** A capability may import a mechanism. A mechanism imports no capability of its workspace. The wiring may import every capability, and no vertical imports the wiring, a test included. Only the routes, the entry folders and the entry files do.
- **V5: at most five.** A capability imports at most five other capabilities of its workspace. A mechanism does not count, nor does the wiring. Code that wires many capabilities is a `wire.ts` outside the verticals.

For V2 and V5, an import is every import the check finds: `import type`, `export from`, `import()` and `require()`. An import through a peer port or of a leaf contract counts too. A test does not count.

When you add, move, rename or remove a vertical, change `VERTICALS` in the same change. The check names the line. A wrong name also fails the type check of `scripts/`.

### Sub-verticals

A folder inside a vertical that has its own `index.ts` is a **sub-vertical**, at every depth. The barrel rules hold at every depth:

- Code outside a sub-vertical imports only its barrel. Inside it, files reach each other freely.
- From inside the vertical, the outermost barrel guards. `flows/flow-page.tsx` does not import `./editor/inspector`, also when `inspector/` has a barrel: it imports `./editor`.
- From another vertical, the import goes through the barrel of the vertical, as before.
- The barrel of a sub-vertical holds only import and export statements. Every name on it has a production importer outside the sub-vertical. Tests may deep-import, and they do not count as importers.

**When a vertical must split (V3).** A vertical or a sub-vertical with more than 25 source files or more than 5,000 lines consists of sub-verticals. Everything below it counts. Tests do not count. Then both of these hold:

1. Each folder directly in it that holds a source file has an `index.ts`.
2. Its own code stays within the same two limits. Its own code is the files directly in it and in its ring folders.

So a flat vertical over a limit fails too. Name a sub-vertical for its sub-domain, with a word the product or the code already uses (`transcript`, `canvas`, `inspector`). Never name it for a kind of code.

The ring folders of section 9 (`domain/`, `application/`, `adapters/`, `adapters/in/`, `adapters/out/`) are not sub-verticals. They need no barrel, and an `index.ts` in one makes no barrel. A folder inside a ring folder counts as a folder directly in the vertical.

### Where verticals live

| Workspace | Verticals in | Also at the top of `src/` |
| --- | --- | --- |
| An app (`apps/web`, `apps/server`, `apps/desktop`, `apps/mobile`, `apps/insights`) | `src/features/<vertical>/` | `routes/` (web, insights), `app/` (mobile: the Expo Router files, thin like the web routes), `shared/`, the generated `env.ts`, and the entry files: `router.tsx` (web), `router.tsx`, `client.tsx`, `main.ts` and `server.ts` (insights), `main.ts`, `hot-preload.ts`, `cli.ts`, `join-cli.ts` and `auth-config.ts` (server), `bun/` (desktop, the Electrobun entry) |
| A package (`engine`, `agents`, `flows`, `api`, `auth`, `db`, `daemon`, `devices`, `notifications`, `telemetry`, `semconv`, `insights`, `client`) | `src/<vertical>/` | `index.ts` (composes the vertical barrels into the package API), the other entries that `exports` names (`api`: `client.ts`, `context.ts`. `flows`: `files.ts`), `testing/`, the generated `env.ts` (`db`), and the files that compose the verticals or that every vertical uses: `auth.ts` (the Better Auth instance), `daemon.ts` and `start.ts`, `router.ts`, `procedures.ts` and `output.ts` (`api`), `wire.ts` (`devices`, `notifications`, `telemetry`) |

- **The top of an app's `src/`** holds only `features/`, `shared/`, entry files, and the one entry folder its framework reads. That folder is `routes/` on the web and on insights, `app/` on the phone and `bun/` on the desktop, listed in `ENTRY_DIRS` of `scripts/check-verticals.ts`. No other folder.
- **`shared/` (apps only)** holds cross-cutting code that is not a product area: the API client, logging, the page shell, time formatting. Each piece in `shared/` is a named folder with its own barrel (`shared/api/`, `shared/time/`). No loose files in `shared/`.
- **No kind buckets at the top of `src/`.** Do not create `src/lib/`, `src/utils/`, `src/helpers/`, `src/hooks/`, `src/components/`, `src/types/`, `src/common/` or `src/misc/`. Exceptions: `packages/ui` and `packages/ui-native` (the shadcn layout).
- **No catch-all names at any depth.** No file named `utils`, `util`, `helpers`, `helper`, `common`, `misc` or `shared`, and no folder named `utils`, `util`, `helpers`, `helper`, `common` or `misc`. Name a file for what it holds (`nodes/base/base.ts`: what every node type shares).
- No catch-all `types.ts` for a whole package. Types live in the vertical that owns them.
- **Files outside `src/`** (config files, scripts, `test/`) belong to no vertical. Like any other file, they import a vertical through its barrel and count as its importers. A file in `test/` is a test.
- **Imports stay inside the workspace.** A relative import never leaves it, and no file imports its own package by name. Production code never imports a test, a fake, a fixture or a test helper.

### Exceptions are listed, not implied

Two exceptions exist, as in yapyap. `scripts/check-verticals.ts` lists each one by name, with a comment that says why.

- **Leaf contract:** a pure-data file (no imports of its own) that a vertical exposes past its barrel. It exists because importing the barrel would close a module-init cycle or load what the importer cannot load. A leaf contract that imports anything fails.
- **Peer port:** two verticals that depend on each other cross only through one named port file per direction. Every other deep import between them stays banned. Often only one direction closes the cycle. Then only that direction has a port, and the other direction imports the barrel. A port, and every file of its vertical that it imports, imports no other vertical than a shared piece. So the port closes no cycle.

The check fails on a leaf contract or a peer port that nothing uses any more, so neither outlives its reason.

Today there is one leaf contract: `features/updates/update-feeds.ts` in `apps/desktop`. The build config (`electrobun.config.ts`) reads the feeds. The barrel of `updates` loads `electrobun/main`, which only the app's main process can load. There are eight peer ports, all in `apps/web` (section 5).

**No new peer port (V8).** `PEER_PORTS` only gets shorter. `scripts/peer-port-debt.txt` holds the eight pairs of verticals, and the budget check fails a pair that is not on it. When two verticals need the same thing, move it into the lower one, or let an entry file pass it in.

### Growth

- Start a new concept inside the vertical that uses it. When a second vertical needs it, promote it to its own vertical.
- A new package is right only when a vertical must sit in a different layer than its host, or when two apps need it.

### Size limits

The limits for a file, a folder, a barrel and a vertical are hard limits. Each has a debt list of what broke it on the day the check started (section 8). A new offender fails. A listed entry may not grow: a change that must add to a listed file splits it first.

- **A source file has at most 600 lines (V6).** Split a longer file by sub-domain. Example: one file per node type, not one inspector for all types.
- **A folder holds at most 25 source files directly in it (V6).** The files of its sub-folders do not count. Move the files of one sub-domain into a sub-vertical.
- **A barrel holds at most 30 names of its own (V4).** A name is a barrel's own when it comes from a file of its folder, its ring folders included. A name that it passes on from the `index.ts` of a sub-vertical counts on that barrel, and not again on the parent. So a vertical with a wide surface is a set of sub-verticals, each a door of at most 30 names. A type and a value both count. The limit holds for the barrel of a vertical and for every `index.ts` below it. A package's root `index.ts` and the entries that `exports` names are out of scope: they compose verticals.
- **A vertical over 25 source files or 5,000 lines consists of sub-verticals (V3).** See "Sub-verticals" above.
- A route file over 80 lines: move the page body into its vertical. This limit stays a signal: no check reads it.

What counts:

- A source file is a `.ts` or `.tsx` file in `src/` or `scripts/` of a workspace. The `scripts/` folder of the repository counts too.
- A test does not count, and it stays next to its file. For a file, a folder and a barrel, a test is a `*.test.ts(x)` file only. A fake and a fixture count there. For V3, a test is also a `test-support.ts` file and a file in a `testing/` or `fixtures/` folder.
- A declaration file (`*.d.ts`) does not count. A generated file does not count: `GENERATED` of `scripts/check-budgets.ts` lists each one with the tool that writes it.
- The in-memory adapters and the contract suites of a slice do not count (section 9).

## 5. The web app

```
apps/web/src/
  router.tsx               the router and its query client (TanStack Start reads it here)
  routes/                  thin TanStack Router files: createFileRoute, search and params, one page from a vertical and its preload
  shared/
    api/                   the oRPC client, query client, server URL, auth client, contract.ts (the API types only the web app needs; the rest come from @nightshift/client)
    page/                  the parts of a page: site header, page heading, loader, logo
    shell/                 the app frame (AppShell): theme, sidebar, toasts, the notifications stream, the tab badge
    format/  time/  code/  data-table/  media-query/   other named cross-cutting pieces, each with a barrel
  features/
    <vertical>/            access, spaces, projects, agents, devices, notifications, settings, flows, gates, runs, dashboard, knowledge, spend
      index.ts             the barrel: the only public surface
      queries.ts           query and mutation option factories, polling rules
      <name>-page.tsx      the page a route renders
      types.ts             this vertical's slice of the API types, when contract.ts is not enough
      <sub-domain>/        a sub-vertical with its own index.ts, when the vertical is big (section 4). Never a kind folder
    flows/                 canvas/ (nodes/, edges/, outcomes/, layout/, sections/, viewer/ the last output on each node), editor/ (add-node/ the node grid, its catalog and the recent nodes, inspector/ one file per node type and a sub-vertical per group of fields, session/, draft/, revisions/, sections/), assistant/, chat/, start/ (Start run and Test, the flow's inputs), schedules/ (a flow's schedules and webhooks), test-run/ (the pins and skips of a test run and the node menu), move/ (copy, import, save as a file)
    runs/                  page/ (run-page.tsx), list/, status/, steps/, story/ (a chapter per step), transcript/ (items/ per group of item kinds, tool-calls/, terminal/), details/, files/, variables/, report/, actions/, ask/, quick-run/
    settings/              settings-page.tsx, form/ (use-settings-form.ts and the fields the cards share), usage/, and one sub-vertical per page: builtin/, runs/, computer/, you/
    agents/                page/ (the Agents pages of Settings), catalog/, setup/, harnesses/, profiles/, models/, connections/ (MCP servers), cli-tools/, secrets/, key-values/
    knowledge/             layout/ (the frame of every Knowledge page), search/, and one sub-vertical per page: overview/, files/, sources/, review/, questions/, map/
    gates/                 inbox/ (the Needs-you inbox)
    notifications/         the stream (use-notification-stream.ts: the live cache follows the Host, with this browser's adapter in browser-notifications.ts), this browser's Web Push (browser.ts, with public/sw.js), settings/ (the notification settings and screens cards)
```

No vertical in this tree holds a kind folder (`components/`, `hooks/`, `lib/`). `scripts/kind-folder-debt.txt` is empty, so a new kind folder fails.

Imports point one way, so no barrel closes a cycle. Biome's `noImportCycles` fails a cycle through barrels too. `scripts/check-verticals.ts` fails a cycle between verticals that has type-only imports in it.

- Routes and `router.tsx` may import any vertical, through its barrel.
- `shared/shell` composes the features. It is the wiring of the app on the capability map (section 4). It is the only shared piece that imports a feature. No feature and no other shared piece imports it. Only the routes and the entry files do. The check enforces this, tests included.
- The other shared pieces import no feature (checked, tests included). Every feature may use them. When a shared piece needs a feature's rule, `router.tsx` passes it in. Example: `createQueryClient` takes `sendToAccess` from `access`, which sends a refused session to sign in.
- The features, from the bottom: `access`, `spaces`, `projects`, `agents`, `devices`, then `notifications` and `settings`, then `flows`, `gates`, `runs`, `dashboard`, then `knowledge` and `spend`. A feature imports only features below it. `notifications` imports no feature, and the inbox and the Settings page show its parts. The Settings page shows the agents, this computer and the notification settings, so `settings` sits above them. The flow editor reads the settings, so `flows` sits above `settings`.
- Data can go the other way. Examples: the Agents page reads the settings, and the inbox lists runs. A vertical below the owner of the data imports the owner's `queries.ts` through a peer port (`scripts/check-verticals.ts`), not its barrel. A `queries.ts` imports only `shared/api`, so the port closes no cycle. The check fails on a port that imports another feature. The ports today:
  - `agents` and `devices` read `settings/queries`.
  - `gates` reads `runs/queries`.
  - `agents` reads `devices/queries` (the Offers of a profile).
  - The Flows page reads `dashboard/queries` (each flow's last runs).
  - `projects` reaches `agents/flow-agents-step` when you add a project: you choose which of your agents takes each agent of the starter flows.
- `devices` and `runs` show each other (the Walker of a run, the runs of an Offer). `devices` reaches the run status badge through a peer port. `flows` reaches the run queries and the status icon through one port, `runs/flows-port.ts` (start a run, a flow's last runs).
- A concept goes to the vertical that owns it in `docs/glossary.md`, not to its biggest user. Outcomes are declared by flow nodes, so `outcome-badge` is in `flows/canvas`. The Walker is a Device, so `walker-badge` is in `devices`.

- A route file declares the route (path, `ssr`, search and params validation) and renders one page from a vertical's barrel. It gives the params and the search to the page as props. It holds no other markup.
- A route starts the data of its page in a `loader` that does not wait. The loader calls the vertical's `preload<Page>` (a `preload.ts` beside the page). That calls `preloadQuery` (`shared/api`): `ensureQueryData` in the browser only, with any error left to the page. The router preloads a route when you point at its link (`defaultPreload: "intent"`).
- A loader never waits for data. Waiting blocks the navigation. The build also prerenders the pages, so a loader runs at build time too, without a session. Each page shows its own skeleton and its own error. A `preload.ts` imports only query options, because the route tree, and so every page, loads it.
- A vertical's `queries.ts` builds its factories from `@nightshift/client` on the app's `orpc` (`createRunQueries(orpc)`), when the package has them. The web-only ones (settings, access, agents) stay in the vertical. Its mutations are the procedures' own options (`{ save: orpc.schedules.save.mutationOptions }`).
- Query options live in the vertical's queries. A component does not build `orpc.x.y.queryOptions(...)` for another vertical's data. It imports that vertical's factory from its barrel, or from its `queries.ts` through a peer port (see above).
- A query factory keeps the query key of the oRPC procedure (`orpc.x.y.queryOptions({ input })`). A polling rule (`refetchInterval` and its `meta`) is part of the factory, in the vertical that owns the data. A call site adds only its own options (`enabled`, `select`, `staleTime`).
- API types come from `shared/api`. It passes on the view types of `@nightshift/client` and adds the ones only the web app needs (`contract.ts`, from `ApiOutputs`). Never derive them again in a component.
- Rules that `@nightshift/flows` or the engine already has are imported, not copied. Examples: template references (`TEMPLATE_REF`), what each node type is called (`NODE_TYPE_LABEL`, `DECISION_LABEL`), whether a listed flow can start (`canStart` of `@nightshift/client`), the harness catalog, what a template may read (`templateScope`), a name clash (`nameClash`), the built-in run policy (`DEFAULT_POLICY`), which actions a run allows (`runNow`, which reads `runActions` of the engine).
- A rule that only a server package can answer comes from the API. Examples: the Traversals of a called flow are `calledTraversals` of `runs.get`. The ranges of the dashboard are the ranges in its reply (`summary.nights`, `summary.activity`). How long a trusted browser skips the code is `twoFactor.trustedBrowserDays` of `account.status`.
- UI follows `AGENTS.md`: shadcn components only.

### The phone app

```
apps/mobile/src/
  app/                     thin Expo Router files: one screen from a vertical
  shared/
    api/                   the auth client per Host, the Host address, the transport (expo/fetch + cookie), the query client (app focus, network), the reads kept between starts
    page/  empty/          the screen body (Screen: the one scroll view under the native header, a summary line) and the empty state
    feedback/              ErrorAlert and ErrorSection (on a native list page): what went wrong on a screen, and how to try again
    format/  clock/        a time of day (formatTime), and times that keep current on one shared ticker (useClock). Costs and the words of "5 min ago" come from @nightshift/client
    in-front/              whether the app is in front (useInFront): the streams follow only then
    refresh/               reading a screen again: on focus and on pull-down (useScreenRefresh)
    theme/                 useThemeColors: the light or dark colors for props that take a color
    tone/                  the status map, pure: tone, icon name and word of a run status, a step, a step kind
    status/                StatusBadge and StatusText: a tone drawn with its icon and word
    list/                  ListGroup, ListRow: lists in a card
    markdown/              text an agent or a flow wrote, as Markdown (Markdown, CodeBlock)
    header/  avatar/       the native header's actions (HeaderToolbar on Stack.Toolbar) and the header of a tab's first screen (TabRootHeader). InitialsAvatar
    trail/                 a run's steps as a timeline (StepTrail)
    native-list/           a page as a native grouped list: SwiftUI on iOS, Jetpack Compose on Android (NativeList, NativeSection and the rows)
    shell/                 the app frame (AppShell), the tabs (AppTabs: native tabs on iOS, JS tabs on Android), the bar above the tabs (AccessoryBar: what waits, and Send) and the stack of each tab (TabStack: large titles)
  features/
    access/                sign-in (address, the Host code, two-factor or backup code), the session, useHostQueries
    spaces/                the Space menu in the header of Runs, the Space remembered per Host
    widgets/               the glances outside the app: the home screen widget (Gates that wait, the latest runs) and a run followed on the lock screen (Live Activity, Android ongoing notification), on expo-widgets
    notifications/         notifications on this phone: the permission card, the Expo push token registered with the Host, the categories and Android channels, the lock-screen buttons and withdraws (background task), the banner in front and the live cache's adapter (phoneNotifications), where a tap goes
    gates/                 inbox/ (the Needs-you inbox), briefing/ (one Gate in full), answer/, transcript/, actions/ (the "More" sheet), needs/ (the Needs you tab: the queue of everything that waits)
    schedules/             what runs tonight, with Pause tonight, Undo pause and Run now
    runs/                  one run live with its steps, Gates and actions, and the files it changed. tab/ (the Runs tab: the runs on their way and the schedules of tonight)
    devices/               the person's computers and whether each can run a flow now (the Computers sheet)
    settings/
```

- The phone UI and its building blocks are in `docs/research/mobile.md`, "Phone UI". A block composes React Native Reusables pieces and tokens. A new block goes in a new named `shared/<name>/`, or in its vertical when only that vertical uses it.

- The features, from the bottom: `access`, `spaces`, `widgets`, `notifications`, `gates`, `schedules`, `runs`, then `devices` and `settings`. `schedules` sits below `runs` because the Runs tab shows the schedules of tonight. A feature opens the screen of another feature by its route (`router.push`), not by an import. `shared/shell` composes them, as on the web. `notifications` sits below the screens because Needs you and Settings show its card. The shell gives its adapter (`phoneNotifications`) to the live cache (`useFollowHost`). `widgets` sits below `notifications` because the background task of a push updates the widget.
- `app/_layout.tsx` calls `startPushHandling()` in its module scope. iOS and Android start the app for a push in the background, and the background task must be defined before any screen renders.
- A screen takes query options from `@nightshift/client` on the Host's client: `useHostQueries(createRunQueries)`. The phone keeps no module-level `orpc`, because its client changes with the Host. A mutation is the procedure's own options on that client: `host.orpc.runs.stop.mutationOptions()`.
- Words and rules that both apps show come from `@nightshift/client` or the `flows` root, never from a copy of a web file. Only the look (icons, colors, layout) belongs to the phone.

## 6. Apps are composition roots

An app wires packages together and talks to the outside world. It does not hold domain logic.

- A file whose tests describe behavior (not routes or wiring) belongs in a package.
- A composition root is a function (`createDaemon(env)`), not a module with side effects at import time.
- One boot sequence. The CLI and the desktop app call the same `startDaemon()`.
- Constants such as the default port have one home.
- Today: `createDaemon(env)` is in `packages/daemon/src/daemon.ts`, `startDaemon()` in `start.ts`. `bun run dev` (`apps/server/src/main.ts`), `nightshift serve` and the desktop app call `startDaemon()`. `DEFAULT_PORT` is in `daemon/src/runtime/port.ts`.

## 7. Enforcement

The pre-commit hook is `lefthook.yml` (install it with `bun lefthook install`). CI is `.github/workflows/ci.yml`. It runs on every pull request and every push to `main`.

| Check | How it runs | Status |
| --- | --- | --- |
| Layer map (L1): `scripts/check-layers.ts` compares each workspace dependency in a `package.json` with the table in section 1. Bun links only declared dependencies, so this is the real import graph. | lefthook pre-commit (when a `package.json`, a `tsconfig`, `biome.json` or a source file changes), CI | Active |
| Package rules: the same script fails on a declared workspace dependency that no file imports or extends (L2), and on an entry that no production file of another workspace imports (L3, a test counts only for `./testing`). It fails on an entry that points past a barrel and is not a light entry (L4). It fails when an allow-list of `noRestrictedImports` in `biome.json` does not name exactly the entries of every `package.json` (L5). The exceptions (`EXCEPTIONS`, `ENTRY_EXCEPTIONS`, `LIGHT_ENTRIES`) fail once they are not needed. | lefthook pre-commit, CI | Active |
| Explicit `exports` in every `package.json` (section 3). A deep import fails `tsc` and fails at runtime. | TypeScript (`bun run check-types`, CI), Bun at runtime | Active |
| Biome `style/noRestrictedImports` forbids a path that `exports` does not list, a relative path into another workspace, and `./testing` outside tests. In `apps/web` it also forbids `engine`, `agents`, `auth`, `db`, every `api` entry and every `flows` entry but the root. In `apps/mobile`, everything but `client`, the `flows` root and `ui-native`. In `apps/insights`, everything but `@nightshift/insights` and `@nightshift/ui`. In `packages/client` (tests apart), every `@nightshift` import but `api/client`, `engine/run-status`, the `flows` root, `notifications/contract` and `time`. `packages/client/src/platform-free.test.ts` also fails on any other package, on `node:` and `bun:`, and on a global of the DOM, Node or Bun. It also fails on any import in the leaves it reads: `engine/run-status` may import only `refusal`, and `notifications/contract` and `refusal` may import nothing. Biome replaces the options of a rule per override, so each override lists the whole set, and the layer check (L5) keeps the lists equal. The tests of `apps/web` have their own override: the web app's rules without the `./testing` ban. | `biome.json`: lefthook pre-commit (staged files), CI (`biome ci`) | Active |
| Biome `correctness/noUndeclaredDependencies`, `suspicious/noImportCycles` and `performance/noReExportAll` (off only for the drizzle schema index). | `biome.json`: lefthook pre-commit (staged files), CI (`biome ci`) | Active |
| Vertical boundaries: `scripts/check-verticals.ts` finds the workspaces and their verticals from the file system. So no list can drift, and a new workspace is checked from its first commit. It reads every file of a workspace, not only `src/`. It fails on any import past another vertical's barrel, apart from the listed leaf contracts and peer ports, and on a vertical without `index.ts`. It also fails on a relative import that leaves the workspace and on an import of the workspace's own name. It fails on production code that imports a test, a fake, a fixture or a test helper. It fails on a peer port that imports another feature, and on a leaf contract or peer port that nothing uses. Tests may deep-import. `bun scripts/check-verticals.ts <workspace>` checks one workspace. | lefthook pre-commit (when a source file, a `package.json` or a `tsconfig.json` changes), CI | Active |
| Files in use: the same script fails on a source file of a vertical that no production file of its workspace imports (rule q). A barrel rule starts at a barrel, so it does not see such a file. An import of one platform file of the phone app (`x.ios.tsx`, `x.android.tsx`) counts for its siblings. A file that `exports` names, or that a script of `package.json` runs, counts as imported. A test is no importer. | lefthook pre-commit, CI | Active |
| Barrel reachability: the same script fails when a barrel exports a name that no file outside the vertical imports. It also fails when a barrel or a package's root `index.ts` holds a statement that is not an import or an export. | lefthook pre-commit, CI | Active |
| Entry names: the same script fails when a name on a package entry has no importer, with the rules of section 3 (production code of another workspace, tests only for `./testing`, a type that a used name's declaration writes). `PENDING_NAMES` lists names that code on its way imports, and fails once they have an importer. | lefthook pre-commit, CI | Active |
| Cycles between verticals: the same script fails on a cycle between the verticals of a workspace, type-only imports included. An import through a peer port or of a leaf contract is not part of a cycle. `KNOWN_CYCLES` lists the cycles that wait for their fix, and fails once a cycle is gone. Today it is empty. | lefthook pre-commit, CI | Active |
| Top-level layout: the same script fails on a kind bucket at the top of `src/`, and on a folder at the top of an app's `src/` other than `features/`, `shared/` and its entry folder. It fails on a loose file in an app's `shared/`, a shared piece that imports a feature, and a vertical that imports `shared/shell`. It fails on a catch-all file or folder name at any depth (section 4). | lefthook pre-commit, CI | Active |
| Sub-verticals and kind folders: the same script fails on a kind folder inside a vertical, at any depth (rule n, V7). It fails on a sub-vertical that breaks a barrel rule (rule o). It fails on a vertical or a sub-vertical over 25 source files or 5,000 lines that does not consist of sub-verticals (rule p, V3). Nine verticals were over 5,000 lines on the day the rule started, and three of them were flat. So a flat vertical over a limit fails too. `scripts/kind-folder-debt.txt` (n) and `scripts/nesting-debt.txt` (o, p) list what broke the rules that day. The check fails an offender that is not listed, and fails a line once it is clean. The rules are modules in `scripts/verticals/`. | lefthook pre-commit (job `verticals`, also when one of the two debt lists changes), CI (step "Verticals") | Active |
| Capability map (V1, V2, V5): `scripts/check-capabilities.ts` compares `scripts/capabilities.ts` with the verticals on disk. It finds them as the vertical check does. It fails on a vertical that the map does not have, and on an entry that is not on disk. It fails on a capability whose word is not a term of `docs/glossary.md`. It fails on a capability vertical under another folder name, and on a mechanism that imports a capability. It fails on a capability that imports more than five others. It fails on a wiring piece in the wrong place: one that is not the `shared/shell` of its app, one in a server package, and a second one in a workspace. It fails on a wiring piece that imports no capability, and on a vertical that imports the wiring piece of its package. `scripts/capability-debt.txt` lists what breaks V1, V2 and V5 today, as `rename`, `imports` and `wide` lines. A `wide` line fails when its count goes up, and when the vertical is at five or less. | lefthook pre-commit (job `capabilities`: when a source file, a `package.json`, a `tsconfig.json`, the debt list or `docs/glossary.md` changes), CI (step "Capability map") | Active |
| Budgets (V4, V6, V8): `scripts/check-budgets.ts` fails a source file over 600 lines and a folder with more than 25 source files. It fails a barrel with more than 30 names of its own, and a peer port that `scripts/peer-port-debt.txt` does not list. It checks the workspaces of the vertical check, and the `scripts/` folder of the repository. Each rule has a debt list in `scripts/`: `size-debt.txt`, `folder-debt.txt`, `barrel-debt.txt` and `peer-port-debt.txt`. A listed entry fails when its number is above the listed number. It also fails when it is within the limit or gone, until its line is removed. `--tighten` lowers the listed numbers to those of today and removes the clean lines. It never adds a line. `bun scripts/check-budgets.ts <workspace>` checks one workspace. | lefthook pre-commit (job `budgets`: when a source file, a `package.json` or one of the four lists changes), CI (step "Budgets") | Active |
| Rings (section 9): `bun run check:rings` (`scripts/check-rings.ts`) checks each slice of the server packages. dependency-cruiser runs the import rules of `.dependency-cruiser.mjs`: H1, H2, H3, H5, H8 and the rule for `adapters/in/`. dependency-cruiser 18.8 cannot use the compiler API of TypeScript 7.0, so swc reads the files. But swc does not report a type written as `import("x").Name`. So `scripts/rings/import-types.ts` fails that form where a rule applies. The script adds the one rule that needs the capability map: `application/` imports only types from a mechanism that is not kernel. The script also holds the file rules. They are the shape of a slice, its `wire.ts`, one use case per file with its test (H6), and the files of each port (H7). It keeps the kernel of a package pure. It fails a server package with tsconfig `paths`, because the rules do not read them. `scripts/hexagon-debt.txt` lists the verticals that are not in shape yet (H10). A listed vertical that keeps every rule and has `application/` fails until its line is gone. A listed slice of rules alone that keeps every rule passes: remove its line when its rules are all in `domain/`. Plain `depcruise` reads the same rules, but it reports every vertical, listed or not. | lefthook pre-commit (job `rings`: when a source file, a `package.json`, a `tsconfig.json`, `.dependency-cruiser.mjs`, `biome.json` or the debt list changes), CI (step "Rings") | Active |
| No `Bun`, `fetch` or `process` in a ring (H4): one override of Biome `style/noRestrictedGlobals` denies them. It covers every `domain/` and `application/` folder of a package, tests included, and the kernel of a package. It does not read the debt list, so it holds from the first file. It does not catch `globalThis.fetch`. `scripts/check-rings.ts` fails when the override does not name exactly those folders and the kernel list (`PACKAGE_KERNEL`). | `biome.json`: lefthook pre-commit (staged files), CI (`biome ci`). The ring check reads the override. | Active |
| The scripts are type-checked: `bun run check-types:scripts` runs `tsc` on `scripts/tsconfig.json`. So a name on the capability map that is no capability fails `tsc` too. `bun run check-types` starts with it. | lefthook pre-commit (job `script types`: when a file of `scripts/` or the base tsconfig changes), CI (step "Types of the scripts", and again in "Types") | Active |
| The clock: `scripts/check-time.ts` fails a call to `Date`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` or date-fns outside `packages/time`. A type `Date` and `instanceof Date` stay. A number's `toLocaleString` is not a clock. `apps/desktop/.hutch` and `apps/desktop/build` are not scanned. `scripts/time-debt.txt` lists the files that still call them. The check fails a file that is not listed, and fails a listed file once it is clean. | lefthook pre-commit (when a source file or the debt list changes), CI | Active |
| Doc paths: `scripts/check-doc-paths.ts` fails a path in a living doc that the repository does not have. The living docs are the README, CONTRIBUTING, AGENTS and SECURITY files, the Markdown files directly in `docs/` and in `docs/steering/`, the files of `.github/`, and `lefthook.yml`. It reads a path from the root (`packages/db/src/schema/`) and a TypeScript file below a folder (`graph/step/sleep.ts`). A glob of the hook or of a workflow that matches nothing fails too. A path that git ignores passes. It does not read the records (`docs/adr/`, `docs/research/`) or the user guide. `EXAMPLES` lists the paths a doc names on purpose, each with its reason, and fails an entry that no doc needs any more. | lefthook pre-commit (job `doc paths`: when a Markdown file, a source file, `lefthook.yml` or a file of `.github/` changes), CI (step "Doc paths") | Active |
| Semantic convention strings: `scripts/check-semconv.ts` fails a `gen_ai.*` or `nightshift.*` telemetry name written as a string literal in a `.ts` or `.tsx` file outside `packages/semconv` and `packages/telemetry/registry`. A comment is not a string literal. `@nightshift/telemetry` and `nightshift` alone do not match. A file name, an email, a host, a bundle id and an app storage key are not telemetry names. | lefthook pre-commit (when a source file changes), CI | Active |
| Collector allowlist: `scripts/check-collector-allowlist.ts` fails when `deploy/insights/collector.yaml` allows a key the registry does not define, or misses a key the usage export sends. The list is the usage-event attributes, the resource attributes in the usage export, and the event name. | lefthook pre-commit (when the Collector config, the usage export, or `packages/semconv` changes), CI | Active |
| The Weaver registry: `weaver registry check --v2 --registry packages/telemetry/registry` fails an invalid registry. CI installs the Weaver version in `packages/telemetry/registry/weaver-version.txt`. | CI | Active |
| Emitted telemetry matches the registry: `packages/telemetry/src/runs/conform.test.ts` fails a name, a type, a unit or a required attribute the registry does not allow. `packages/telemetry/src/wire.test.ts` runs the same check on a run from the in-memory engine. | `bun test` in `packages/telemetry`, CI | Active |
| The checks have tests. `scripts/check-verticals.test.ts`, `scripts/check-layers.test.ts`, `scripts/check-time.test.ts` and `scripts/check-semconv.test.ts` prove each rule on small workspaces, with one tree that breaks it and one that keeps it. They also prove that each script passes on this repository. `scripts/test-workspaces.test.ts` does the same for the list of tested workspaces. The checks of sections 4 and 9 have tests too. The vertical rules: `scripts/verticals/folder-names.test.ts`, `nesting.test.ts`, `nesting-size.test.ts` and `unused-files.test.ts`. The capability map: `scripts/check-capabilities.test.ts`. The budgets: `scripts/check-budgets.test.ts` and `check-budgets-barrels.test.ts`. The rings: `scripts/check-rings.test.ts` and `scripts/rings/imports.test.ts`, on fixture repositories. The doc paths: `scripts/check-doc-paths.test.ts`. | `bun test ./scripts/`: lefthook pre-commit (job `check tests`), CI (step "Tests of the checks"). The hook job runs when a check script changes, or a module of `scripts/verticals/` or `scripts/rings/`. It also runs when `.dependency-cruiser.mjs`, `scripts/hexagon-debt.txt`, the capability map or its debt list changes. It gives each test 60 seconds, because some tests read the whole repository. | Active |
| Types and tests: `bun run check-types` (the scripts, then every workspace, with the web build), and `bun test` per workspace (without `*.live.test.ts`). `scripts/test-workspaces.ts` finds the workspaces with tests, so CI tests a new workspace without an edit. | CI | Active |
| The compiled binary starts: `apps/server/scripts/smoke-binary.ts` builds it and starts it as the Docker image does. | CI | Active |
| API contract: every procedure has a one-line summary and an output schema, and the OpenAPI document builds with both. Real replies of a sandbox engine match their schemas. `exact<T>()` fails the build when an output schema differs from its domain type. | `packages/api/src/contract.test.ts` (CI), TypeScript | Active |

`scripts/check-verticals.ts` checks every workspace except `ui`, `ui-native` and `config`. When a check exists, change its status to "Active". The scripts find the workspaces themselves, so a new workspace needs no list entry. Fix a violation. Do not add an exception, and do not add a line to a debt list (section 8). If a rule is wrong, change this document first.

## 8. Known deviations

When code must break a rule for a while, add an entry here: the rule it breaks, the files, and the change that removes it. Remove the entry in the change that fixes it. Do not copy a deviation into new code. A check lists each entry too, and that check fails once the deviation is gone.

| Rule | Files | Until |
| --- | --- | --- |
| The clock (`scripts/check-time.ts`) | The lock-screen widget builds a `Date` for the native timer (`apps/mobile/src/features/widgets/lock-screen.ios.tsx`). Its `widget` function cannot import a Night Shift package. `scripts/time-debt.txt` lists that file. | the widget timer takes an instant |

The rules of 2026-11-18 (sections 4 and 9) each started with a **debt list**: a file in `scripts/` that names what broke the rule on that day. The lists are `scripts/hexagon-debt.txt` (the rings), `capability-debt.txt` (V1, V2, V5), `size-debt.txt` and `folder-debt.txt` (V6), `barrel-debt.txt` (V4), `nesting-debt.txt` (V3), `kind-folder-debt.txt` (V7) and `peer-port-debt.txt` (V8). Each list only gets shorter: never add a line, and never raise a number. A line leaves when its code is clean: the check then fails and names the line, and you remove it in that change. For the three lists with numbers (size, folder, barrel), `bun scripts/check-budgets.ts --tighten` lowers each number to the number of today and removes the clean lines. One case adds a line: when a listed vertical of a server package splits, the new vertical gets a line on `scripts/hexagon-debt.txt`. It gets its place on the capability map in the same commit.

## 9. Rings: the inside of a capability

A capability of a server package is a **slice** with three rings. Imports point inward: `adapters/` to `application/` to `domain/`. [ADR 40](../adr/0040-a-capability-has-three-rings.md) records why.

- The server packages are `engine`, `devices`, `notifications`, `agents`, `auth` and `telemetry` (`SERVER_PACKAGES` of `.dependency-cruiser.mjs`).
- A slice is a vertical of a server package that the capability map gives a capability (section 4). Each sub-vertical of it is a slice too.
- Only a slice has rings. A mechanism has none. `api` has none: it is the driving adapter for people. The apps and the other packages have none. The rules of section 4 hold for all of them.
- A vertical that is not in shape yet is on `scripts/hexagon-debt.txt` (section 8). A new slice starts in shape. A line names a vertical, never a sub-vertical: a vertical is in shape with all its sub-verticals, or it is listed.

### The slice

```
packages/engine/src/<capability>/
  index.ts                     the barrel: the wire function, use cases and types. Never a store, never a real adapter
  wire.ts                      wire<Capability>(deps): builds the real adapters, returns the use cases bound to their ports
  domain/                      the rules, as pure TypeScript: no I/O, no framework
    <thing>.ts  <thing>.test.ts
  application/                 flat: no folder in it
    ports.ts                   the driven ports: types only
    <verb>-<object>.ts         one use case: one exported function
    <verb>-<object>.test.ts    its test, on in-memory adapters
  adapters/
    out/                       the driven adapters
      <tech>-<port>.ts           the real adapter: drizzle, node:fs, git, Yjs, fetch
      in-memory-<port>.ts        the in-memory twin (test code)
      <port>.contract.ts         one suite for both adapters (test code)
      <port>.contract.test.ts    runs the suite on both
    in/                        a driving adapter that is not the API: a timer, a listener
  <sub-vertical>/              a folder with its own index.ts, in shape too
```

- The slice folder holds only `index.ts`, `wire.ts` and tests (`*.test.ts`, `test-support.ts`).
- Each folder in it is a ring or a sub-vertical.
- A slice has `domain/` or `application/`, or a sub-vertical that has one.
- A slice without `application/` is a slice of rules alone: `domain/` and its barrel. A capability of pure rules has this shape. It needs no `wire.ts`, and it has no `adapters/`. Its barrel passes on only the names of its `domain/` and of its sub-verticals: pure functions, pure values and types. It passes on nothing of another vertical or package.
- `application/` is flat. `adapters/` holds only `out/` and `in/`.
- No folder below a ring has the name `domain`, `application` or `adapters`.

### The rules (P1 to P8)

**P1. `domain/` is pure.** It imports only its own `domain/` and the kernel. It takes an instant as an argument: it does not read the clock. A type of another slice does not enter `domain/`. An answer type that names one sits in `application/`.

The kernel is what every ring may import:

- `@nightshift/refusal`, `@nightshift/time` and `@nightshift/semconv`, by any entry but `./testing`.
- The root of `@nightshift/flows`.
- `zod`: a schema is domain.
- `node:crypto`, for a pure computation only: an HMAC, a constant-time compare. It is not for a random value. A function gets an id or a random value as an argument or through a port.
- The kernel of its own package: its pure mechanisms, through their barrels (`../../contract`, not `../../contract/command`). `PACKAGE_KERNEL` of `.dependency-cruiser.mjs` is the list: `contract` and `run-status` in the engine, `contract` in `devices`, `contract` in `notifications`. A kernel mechanism imports no database, folder, process or network module. It uses no `Bun`, `fetch` or `process`.

**P2. One request is one use case.** A use case is one file in `application/`, with one exported function and one test file beside it. A step that two use cases share is a pure function in `domain/` that takes a function. `application/` imports only:

- Its own `domain/` and `application/`, and what `domain/` may import.
- The barrel of another vertical or sub-vertical of its package. So a use case may call the use case of another slice through that barrel.
- From a mechanism that is not kernel: types only (`import type`). A use case gets a value of a mechanism that does I/O through a port: the run log, the runner.
- From a lower-layer `@nightshift` package that is not kernel: types only, from a public entry. `@nightshift/db` is the exception: no import at all. A use case gets a value of such a package through a port.

It never imports `adapters/`.

Only `adapters/out/` touches the outside. `domain/` and `application/` import no module that reaches a database, a folder, a process or the network. A type-only import counts. The list: `@nightshift/db`, `drizzle-orm`, `@libsql/*`, `bun:sqlite`, `node:fs`, `node:child_process`, `node:net`, `node:http*`, `node:dns*`, `yjs`, `@langchain/*` and `@hocuspocus/*`. They also use none of the globals `Bun`, `fetch` and `process`.

**P3. A use case takes its ports as its first argument.** It reads no global and builds no adapter. Its other arguments fit who asks:

- A request of a person: `(ports) => (actor, request)`.
- The clock or a public webhook: `(ports) => (request)`.

```ts
export type AnswerGatePorts = { gates: OpenGates; walkers: Walkers; members: SpaceMembers; clock: Clock };
export const answerGate =
  (ports: AnswerGatePorts) =>
  async (actor: Actor, request: AnswerGate): Promise<void> => {
    // load, ask the domain rule, save
  };
```

`application/` takes a `now` port only where a test must set the time. State that outlives a request (a watch, a short memory) is a pure domain object. The wire makes it once and gives it to the use case beside the ports. It is not a port, and it needs no twin. The same holds for a collaborator with no I/O.

**P4. The use case decides who may act.** It takes the `Actor`. The API keeps the session check and the input schema. For an expected outcome, the use case throws a `Refusal`. There is no `Result` type. Until the run path is in shape, `actor` is `Actor | undefined`.

**P5. A driving adapter holds no rule.** It reads the input, calls one use case and maps the answer. The API is the driving adapter for people. `Engine` and `SpaceEngine` are thin objects that list the use cases for it, and they hold no rule. A driving adapter that is not the API sits in `adapters/in/`. A file there imports nothing of its slice: the wire hands it the bound use case.

**P6. Only a `wire.ts` builds a real adapter.** A slice with `application/` has a `wire.ts`. It exports one function, `wire<Slice>(deps)`, and types. It is the only file that builds the real adapters and the long-lived domain objects of the slice. It returns the use cases bound to their ports.

Only that `wire.ts`, a file of the same `adapters/out/` and a test import a real adapter. The `wire.ts` of the package calls the slice wires (in the engine, `createEngine` does until it moves). It never builds the adapter of a slice itself.

**P7. Every driven port has an in-memory twin and one contract suite.** Every type that `application/ports.ts` exports is a port. A data shape goes in `domain/`. A store port is narrow and belongs to one slice (`ScheduleStore`). There is never a port for the whole database.

The twin sits beside the real adapter in `adapters/out/`, and the contract suite runs on both. A use-case test runs on the twins.

A port that another slice or another package implements says so in the comment of its type: `/** The runs a schedule starts. @filledBy engine/run */`. The name is a package (`@filledBy devices`) or a vertical of one, on disk, and not the slice itself. A port that a sub-vertical fills names its vertical. When the `wire.ts` of a package builds the port from several things, the name is that composition: `@filledBy engine/wire`. The package then has a `src/wire.ts`. Such a port has an in-memory twin and no contract suite. One file `adapters/out/in-memory-*.ts` may hold the twins of several of these ports. When a slice of the same package fills the port and is in shape, import its barrel in the use case and remove the port. The check does not ask for that.

Twins and contract suites are test code. Production code never imports them. They do not count for the size, folder and nesting rules of section 4.

**P8. A slice calls another slice through its barrel.** The barrel exports the wire function, use cases and types. It never exports a store or a real adapter.

### Tests in a ring

- A test in `domain/` or `application/` keeps the import rules of its ring. It may also import `bun:test` and the `./testing` entry of a kernel package (`@nightshift/time/testing`, `@nightshift/flows/testing`).
- A use-case test may also import an in-memory twin of any slice of its package. It imports no real adapter, no `testing/` folder, no `@nightshift/db` and no `node:fs`. So it starts no database, folder or process.
- No `Bun`, `fetch` or `process` in `domain/` and `application/`, tests included. A port type does not write `typeof fetch` either: write the function type.
- In `domain/`, `application/` and `adapters/in/`, write `import type`. A type written as `import("x").Name` fails, because the import rules do not read that form.

### The names the ring check expects

| Place | File | What the check asks |
| --- | --- | --- |
| The slice folder | `wire.ts` | One exported function, `wire` and the folder name in PascalCase: `schedules` gives `wireSchedules`, `run-status` gives `wireRunStatus`. A sub-vertical takes the name of its own folder, not of its path: `runs/actions/` gives `wireActions`. Types are fine too. |
| `application/` | `ports.ts` | Types only: no value export. |
| `application/` | `<verb>-<object>.ts` | Lower case with dashes. One exported function with the camelCase name of the file: `answer-gate.ts` exports `answerGate`. Write it as `export function` or as `export const x = (...) => ...`. Types are fine too. |
| `application/` | `<verb>-<object>.test.ts` | One per use case, beside it. No other test file. |
| `adapters/out/` | `<tech>-schedule-store.ts` | The real adapter of the port `ScheduleStore`. `<tech>` is any prefix in lower case: `drizzle-`, `flow-document-`, `node-`. |
| `adapters/out/` | `in-memory-schedule-store.ts` | The twin. It imports `ScheduleStore` from `../../application/ports`. |
| `adapters/out/` | `schedule-store.contract.ts` | The contract suite. It exports one function, `scheduleStoreContract`, and imports the port. |
| `adapters/out/` | `schedule-store.contract.test.ts` | It imports the suite, the twin and the real adapter. |
| `adapters/in/` | `<name>.ts` | It imports nothing of its slice. Its test may. |

The check makes the file name from the port name: `ScheduleStore` is `schedule-store`, `HTTPClient` is `http-client`, `Clock` is `clock`. A port with `@filledBy` that has a real adapter in its own slice fails.

### Bring a slice into shape

1. Read the header of `scripts/check-rings.ts`. It holds the rule text.
2. Move each rule that needs no I/O into `domain/`. Give it the instant as an argument.
3. Write `application/ports.ts`: one type for each thing the slice asks of the outside.
4. If another slice or another package implements a port, write `@filledBy` in its comment.
5. Write one use case file for each request, in `application/`. Move the check of who may act into it.
6. Write the test of each use case beside it, on in-memory twins.
7. Move each call to the database, a folder, a process or the network into a real adapter in `adapters/out/`.
8. Write the in-memory twin and the contract suite of each port. Run the suite on both adapters.
9. If a timer or a listener drives the slice, move it to `adapters/in/`.
10. Write `wire.ts`. Build the real adapters there, and return the use cases bound to their ports.
11. Export the wire function and the types from the barrel. Remove each store from it.
12. Call the wire function from the `wire.ts` of the package (in the engine, from `createEngine`).
13. Keep each old test that goes through `createEngine` until a use-case test with the same assertion passes beside it.
14. If the slice splits and a new vertical comes of it, add that vertical to `scripts/capabilities.ts` and to `scripts/hexagon-debt.txt`.
15. Remove the line of the slice from `scripts/hexagon-debt.txt` in the same commit.
16. Run `bun run check:rings`, `bun scripts/check-verticals.ts`, `bun scripts/check-capabilities.ts` and `bun scripts/check-budgets.ts`.
