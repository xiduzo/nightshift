# Devices: running Night Shift on more than one computer

Status: 2026-10-27: [ADR 1](../adr/0001-one-personal-space-per-home-host.md),
[ADR 2](../adr/0002-flows-are-night-shift-data.md) and
[ADR 3](../adr/0003-a-profile-belongs-to-one-device.md) change parts of
this design. The sections below that state the new rule say "(ADR N)".
The slice logs stay as they were built. Before that: proposal, 2026-10-19,
revised twice the same day. Nothing here is
built. The shape is decided: **peers with a local Replica, synced through a
Host**. Three other shapes (a hub with thin runners, peers on one shared
remote database, independent daemons with git as the bus) were compared
and set aside; the first revision of this file has them.

## The wish

- Run the engine on another computer: a second laptop, or a headless
  server.
- Several devices, like several projects. Each device has its own agents
  (harnesses, logins) and its own tools (programs, MCP servers).
- A flow says where a node runs, so compute is split across devices.
- Any client, from anywhere, opens Night Shift and starts a flow whose
  nodes are the responsibility of other machines.
- A project is shared between devices through its remote repository, like
  two developers.
- Every device keeps a local copy of the data, and the copies stay in sync.
- The network of machines is secure by default. A colleague can join one
  project and never touch private projects or settings.

## What is true today

| Fact | Where |
| --- | --- |
| One daemon writes one database. A second daemon on it refuses to start (the Lease). | `packages/daemon/src/runtime/lease.ts` |
| A Project is an absolute path of a clone, unique in the database. | `project.repo_path` |
| A Run has one worktree, a sibling folder of that clone, on this computer. | `run.worktree_path`, `projects/worktrees.ts` |
| Harnesses, CLI Tools, Connections, Secrets and Agent Profiles are daemon-wide and say "this computer". | the Agents and Settings pages |
| Transcripts and command logs are files in the daemon's data directory. | `log/transcripts.ts` |
| Every daemon's scheduler reads every project's `.nightshift/schedules.json`. | `schedules/scheduler.ts` |
| The UI talks to one server URL. Procedures are public: local single-user mode. | `VITE_SERVER_URL`, `packages/api/src/router.ts` |
| Better Auth is wired; one local user is auto-created. | `packages/auth` |
| TECH constraint already written: "Put a tenant id on every row. No query crosses a workspace." | `docs/steering/TECH.md` |

What already points the way: the oRPC ADR ("remote runners call it
later"), the tenant-id constraint, and the engine's data rule: **durable
facts, derived status, an append-only event log**. After the 2026-10-19
refactors every node body runs through one step runner, whose
`body(step, entry)` is the exact piece of a step that touches a computer.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Person | A user account on a Host. Better Auth's user. |
| Device | A computer that runs Night Shift: a full daemon with its own Replica, its own agents, tools, secrets and Clones. Owned by one Person. Named by them ("MacBook", "studio", "hetzner-1"). The desktop app is a Device. |
| Host | A Device that also runs the auth server, the relay and the archive, and serves the UI to a browser. Any Device can be a Host, the desktop app too. A Host is where Devices find each other, not an authority over their data. |
| Home Host | The one Host a Device's owner runs or trusts with the Device's private configuration. A Device has exactly one. |
| Guest Host | Any other Host a Device joins, for the shared Spaces its owner is a member of there. A guest Host never receives the Device's private configuration. |
| Replica | A Device's local database: everything its owner may see, as far as the Device has synced. The UI reads its own Device's Replica. |
| Owner | The one Device (or Walker) that writes a row. Sync never merges two writers of one row. |
| Walker | The Device that drives a Run's Thread and writes its event log and transcripts. One per Run at a time. Default: the Space's Host. |
| Space | The unit of sharing and of sync: Projects, their Runs, their Gates, Offers into it, and Members with roles. A Better Auth organization. Every Person has a personal Space nobody can be invited to. |
| Member | A Person in a Space, with a role: owner, admin, member, viewer, or a custom one. |
| Offer | A Device's Agent Profile made available to one Space, with limits: a permission-mode cap and a session cap. The only way a Space's Members run anything on a Device they do not own. |
| Clone | A Project's repository on one Device, at a path. Its existence is known to the Space; its path only to the Device's owner. |
| Placement | Which Device a step's body runs on: the node's `device`, else the profile's Device, else the Walker. Across Persons, only through an Offer. |
| Hand-off | The git push and fetch of the Run's branch between two steps on different Devices. |
| Capabilities | The facts a Device reports: harnesses and models, programs, secret names, Clones, online state. Private to its owner; an Offer exposes one profile's name. |

## The shape

```mermaid
flowchart TB
  subgraph host["Host · studio, a server, or the desktop app"]
    hu["UI for any browser"]
    hd["daemon: walks runs, scheduler"]
    hr[("Replica + archive")]
    hs["auth · relay · archive"]
    ht["claude · gh · clone"]
  end
  subgraph mac["Device · MacBook"]
    md["daemon"]
    mr[("Replica")]
    mt["claude-max login · gh · keychain · clone"]
  end
  subgraph hz["Device · hetzner-1 (headless)"]
    zd["daemon"]
    zr[("Replica")]
    zt["opencode · docker · office MCP servers · clone"]
  end
  phone["a browser, anywhere"]
  remote[("git remote")]
  md -. "outbound: sync, step requests, event streams" .-> hs
  zd -. "outbound" .-> hs
  phone --> hu
  mt <--> remote
  zt <--> remote
  ht <--> remote
```

Every Device is a full Night Shift on its own libsql. Devices connect
outbound to a Host and exchange what changed. Any Device's UI shows every
Device, run and gate it may see, from its own Replica. A Run is walked by
one Walker; its steps run where they are placed.

## Why it holds: every row has one Owner

Night Shift's data falls into five classes. Each has one writer, so run
data never needs conflict resolution.

| Class | Examples | Owner | Sync rule |
| --- | --- | --- | --- |
| Device facts | harnesses and models, programs, secret names, binary paths, session cap, Clones, online state | the Device | copy the Owner's latest version |
| Device configuration | its Agent Profiles, CLI Tools, Connections, Offers | the Device, edited from any of its owner's UIs | the Device document (Yjs): edits merge, the Owner applies them |
| Space definitions | Projects by remote, which Devices have a Clone, Offers into the Space, Members (mirrored from auth) | any Member for Projects; the offering Device for Offers | the Space document (Yjs) |
| Run history | runs, steps, sessions, events, `HandedOff` | the Walker | exchange by cursor: immutable rows, the union is the merge |
| Run state | LangGraph checkpoints, transcripts, command logs | the Walker | copied to the Space's Host archive when a node ends; fetched on demand; a running step's transcript followed live while someone watches it |

Consequences: status derives the same on every Replica (a Run's events
come from one Walker in one order; `event.seq` becomes `(walkerId, seq)`),
and exactly-one is by rule, not by lock (the Walker is chosen at start,
the step's Device is the Placement; moving a Run is a person's action).

## Sync layers

Two mechanisms, each on the data it is good at:

- **Yjs through Hocuspocus** for the Device document and the Space
  document: small, mutable, edited from several UIs. Hocuspocus 4 (stable
  2026-05) runs in the Host's daemon with `onAuthenticate` and a SQLite
  persistence extension; awareness gives presence. Yjs is not for run
  history: the whole document loads into memory and log-shaped documents
  grow without bound.
- **Event log exchange over oRPC** for run history and run state: a Device
  asks its Host "what do you have of owner X after seq N", streams new
  events live, and copies checkpoints and transcripts to the archive.
  Immutable or single-owner rows make the merge trivial. This is the
  custom piece; it is small because nothing in it resolves a conflict.

Watched, not used: Turso Sync (`@tursodatabase/sync`, local writes with
push and pull to a primary) is the one-mechanism alternative once it is
1.0 and Drizzle speaks it; today it is the new engine at 0.8-pre with a
known replay bug. LiveStore has our event-sourcing model but is 0.4 on a
Cloudflare-shaped backend. cr-sqlite upstream is dormant.

## Security and sharing

### The trust model

Four things, kept apart:

| Thing | Answers | Backed by |
| --- | --- | --- |
| Person | who | Better Auth user on a Host; invitation-only signup; the first user is the Host admin (admin plugin) |
| Device | which machine, owned by whom | an API key (API key plugin) bound to the owner, issued by the device authorization flow (RFC 8628, device authorization plugin) with approval in the UI; hashed at rest; revocable on the Devices page |
| Space | what is shared with whom | an organization (organization plugin): members, roles, invitations, the active Space of a session, permission checks |
| Offer | which compute a Space may use | a row in the Device document and the Space document, enforced by the offering Device itself |

```mermaid
flowchart LR
  P["Person"] -- owns --> D["Device"]
  P -- member, role --> S["Space"]
  S -- holds --> Pr["Project"]
  Pr -- runs --> R["Run"]
  D -- has --> C["Clone of a Project"]
  D -- has --> Pf["Agent Profile"]
  Pf -- offered into --> S
  D -- home --> H["Home Host"]
  D -- guest --> G["Guest Host"]
  H -- hosts --> S
  G -- hosts --> S2["another Space"]
```

### Private by default

- Everything a Person makes starts in their **personal Space**: projects,
  runs, gates. Nobody can be invited to it. Sharing is a new Space plus an
  invitation, never a switch on something private.
- A Person has **one personal Space per Home Host**. When a Device joins
  its Home Host, its own personal Space and the Person's personal Space on
  that Host become one Space, which the Host keeps. All the Person's
  Devices, with their profiles, CLI Tools and Connections, are usable there
  without Offers. A Guest Host never merges: it gets only shared Spaces
  (ADR 1).
- A Device's configuration (profiles, tools, connections, secret names,
  binary paths) lives in its **Device document**, which syncs only through
  its **home Host** and only to Devices of the same owner. A guest Host
  never receives it. A Member of a shared Space sees of your Device only:
  its name, that it is online, that it has a Clone of the shared Project,
  and the names of the profiles you offered.
- **Secret values never leave their Device.** Values are in that Device's
  keychain or environment; `${NAME}` resolves where the MCP server starts.
  Secret names are owner-private: every Device of the Person sees the
  secret names of each of their Devices, nobody else does. A step that
  needs a Secret runs on a Device that has it (ADR 1).
- **Every row carries a Space id** (the TECH constraint). The Host filters
  every sync, relay and stream by membership. The Replica holds many
  Spaces; every query is scoped to one.

### Sharing a project with a colleague

1. You create a Space "Platform" and invite the colleague by email. Your
   Host is invitation-only, so the invitation is also their account.
2. You move (or add) the Project into "Platform". Its Runs and Gates are
   now the Space's. Your other projects stay in your personal Space.
3. The colleague pairs a Device with your Host: `nightshift join
   https://host.example` prints a code, they approve it in your Host's UI,
   their Device gets a key. Your Host is a **guest Host** for that Device:
   it receives "Platform" and nothing else. Their private work stays on
   their own home Host.
4. Their Device adds its Clone of the Project. Now both of you see where
   the Project exists. They draw flows in the editor. The Space keeps
   them, so you see each save at once, with no push or pull (ADR 2).
5. If you want their flows to use your hetzner-1, you **offer** profile
   `codex-server` of hetzner-1 into "Platform", with a permission cap
   (`acceptEdits` at most) and two sessions at most. They place a node on
   `hetzner-1` with `codex-server`. A node of theirs that names anything
   else on hetzner-1 refuses to start.
6. Every step that runs through an Offer logs who started the Run and
   whose Device ran it. Your Devices page shows "runs for Platform" on
   hetzner-1 and lets you withdraw the Offer at any time; running steps
   end as stopped.

```mermaid
sequenceDiagram
  participant Y as You (Host owner)
  participant H as Your Host
  participant C as Colleague
  participant CD as Colleague's Device
  participant HZ as Your hetzner-1
  Y->>H: create Space "Platform", invite colleague
  H-->>C: invitation (account + membership)
  C->>CD: nightshift join https://host.example
  CD->>H: device code
  C->>H: approve code in the UI
  H-->>CD: device key (API key, owner = colleague)
  CD->>H: sync "Platform" only (guest Host)
  Y->>H: offer hetzner-1 / codex-server into "Platform"
  C->>H: start run, node placed on hetzner-1
  H->>HZ: body(step, Space Platform, offer codex-server)
  HZ->>HZ: checks: offer exists, requester is a Member, Clone present, cap holds
  HZ-->>H: events (logged: started by colleague, ran on your hetzner-1)
```

### Roles and permissions

The organization plugin's access control, with Night Shift's statements:

| Statement | Actions |
| --- | --- |
| `project` | add, remove, move |
| `run` | start, stop, resume, move, export |
| `gate` | resolve |
| `signal` | send |
| `offer` | use |
| `member` | invite, remove, role |
| `space` | settings, delete |

Default roles: **owner** (all), **admin** (all but `space.delete`),
**member** (`project.add`, `run.*`, `gate.resolve`, `signal.send`,
`offer.use`), **viewer** (nothing that writes). Custom roles through the
plugin's dynamic access control when someone needs "may resolve gates but
not start runs". Checks run on the server (`hasPermission`), never only in
the client.

A Device key's own permissions are narrower than its owner's: `sync`
(pull, push), `relay` (serve bodies), `archive` (put, get). Who may do what
in a Space is always the owner's membership, checked per call.

### What the offering Device enforces itself

The Host is trusted to relay and to filter, but the Device that runs
someone else's step checks again, from its own Replica, before it starts
anything:

- The request names a Space and an Offer this Device made into that Space.
- The requester is a Member of that Space with `offer.use`.
- The Project is one this Device has a Clone of, in that Space.
- The permission mode and the session count stay within the Offer's caps.
- The run worktree gets a git identity of the Person who started the Run
  (`user.name`, `user.email` in the worktree's config), so commits are in
  their name, not the Device owner's.

One module does these checks (the Offer admission, `offers/admission.ts`),
whether the Device walks the Run itself or a Walker elsewhere sends the
call through a Host. The role is checked at every call, a call that names
no starter is refused, and the session cap counts the sessions of both
paths.

What an Offer cannot hide, and the Offer dialog says so: an agent on your
Device runs with your harness login and your CLI tools. A `gh pr create`
in a flow a colleague wrote is your `gh`. Offer a profile whose tools you
would hand to that Person.

### Secure by default

1. A Host listens on localhost until it has an `https://` address. Join
   URLs are `https://` only. A Host without a certificate authority can
   use a self-signed certificate: the pairing code shows its fingerprint,
   the Device pins it on approval. See "Connectivity" for how a Host gets
   an address.
2. Signup is invitation-only. The first user is the Host admin.
3. Devices pair by the device authorization flow with approval in the UI.
   Keys are hashed at rest, carry the Device id as metadata, expire after
   a configurable idle time, and are revoked from the Devices page.
   Revoking a Device ends its sync, its Offers and its running steps.
4. Private by default, as above. Sharing is a Space, an invitation and an
   Offer, each explicit.
5. The Host filters by membership; the Device re-checks Offers. Two
   checks, two code paths.
6. Audit in the Space's event log: `MemberJoined`, `MemberRemoved`,
   `OfferMade`, `OfferWithdrawn`, `DeviceJoined`, `DeviceRevoked`, and
   `RunStarted` with the Person, `StepStarted` with the Device.
7. Better Auth 1.6.11 or later: CVE-2026-45337 let an authenticated user
   approve another user's pending device code in 1.6.0–1.6.10.
8. Later: end-to-end encryption of Device documents, so even the home Host
   stores only blobs; and "sign in with your own Night Shift" (the OIDC
   provider plugin on the home Host, generic OAuth on the guest Host), so
   a colleague needs no second password.

What is deliberately not promised: the Host operator can read what the
Host archives for the Spaces it hosts. Transcripts of shared Runs are
shared Runs. Put a Space on a Host whose operator may see it.

## The design

### The Device port

What a step body needs from a computer, as one interface with two adapters.

```ts
type Device = {
  id: string;
  name: string;
  state(): DeviceState;
  capabilities(): Capabilities;
  session(input: AgentSessionInput): AsyncIterable<AgentEvent>;
  exec(input: CommandInput): AsyncIterable<CommandEvent>;
  callTool(input: ToolCallInput): Promise<ToolResult>;
  decide(input: DecisionInput): Promise<DecisionResult>;
  worktree(run: RunRef): Promise<Worktree>;
};
```

`localDevice(deps)` is what `createDaemon` (`packages/daemon/src/daemon.ts`) wires today. `remoteDevice(relay,
id)` makes the same calls through the Host to that Device's daemon, which
serves them with its own `localDevice` after the Offer checks. The
Walker's step runner asks `deviceFor(node, run)` once per step; node
bodies stop touching `harness`, `spawn`, MCP or `Bun.which` directly.

### Agents and tools per Device

Agent Profiles, CLI Tools and Connections are a Device's own. The Agents
page groups them by Device. A profile's identity is its Device and its id;
its name is a label. A node names that pair ("builder on LE2316"), and the
profile's Device is where the step runs. Two Devices may each have a
profile labelled "builder"; Night Shift never uses one for the other. When
the profile's Device is offline, the step waits for it. A Project has no
profiles of its own (ADR 3). In a personal Space, every profile of the
Person's Devices is usable without an Offer (ADR 1). Across Persons, a
profile is visible only as an Offer.

### Placement

1. The node's `device`. 2. The profile's Device. 3. The Run's Device: the
Device that started the Run, or the Host for a Run started from a Phone or
a browser on the Host (ADR 1). 4. The Walker.

A profile is a Device's own: a node names it by Device and profile id
(ADR 3). A placed Device that is offline makes the step wait, up to the
Run's stop time (ADR 1).

Explicit names, not a matcher. The run-start requirements read the placed
Device's capabilities, or the Offer: "The flow uses `gh` on `hetzner-1`,
but that device has no `gh`"; "hetzner-1 offers `codex-server` to this
Space, not `claude`". `device: "any"` can come later.

Placement is decided once, when the run starts, as the run plan. The
devices' planner (`placement/placement.ts`, `PlacementPort.plan`) finds
the Person the run runs for (as the Host of its Space knows them), the
run's Device and each named Device (one of the Person's own, or another
Person's through its Offers, online, with a Clone where it needs one),
and runs the engine's node walk (`planNodes`) over them: the rule above,
with each profile resolved where its node runs. The nodes on an offered
Device must stay within its Offers. The run's row keeps the plan
(`device_id`, `placements`, `device_names`, `started_by`), and the walk
reads it (`planOf`) and decides nothing again: a restart needs no list of
Devices to name them. A move keeps the plan; only the Walker changes. A
node's Device field in the editor lists what the planner allows
(`runs.devices` with `forNode`). A run from before the plan kept names
walks with the names its nodes give.

The Person's other Devices come from the Replica that keeps the Space: on
a Device in a Host's Space, the Host answers. When the home Host cannot be
reached, the Device lists its owner's other Devices from their document
copies (ADR 1): offline, with their names and last known profiles, and a
Clone where the Space document says so. A node that names one of them
waits for it. A Host that cannot tell a Device's profiles (it keeps no
copy) gets them from the Device's own copy. Never for another Person, and
never in a Space of a Guest Host.

### Who walks

A Run's Walker is chosen at start; the default is the Space's Host, because
it stays on and a browser-only client has no daemon. A Device that starts
a Run in a Space a Host keeps gives the walk to the Host, and its unplaced
steps still run on that Device (ADR 1). A Device that cannot reach its Host
walks the Run itself, and the Exchange sends it to the Host later. The Run's worktree lives on the Device
of its first placed step. "Move this Run to studio" ends the walk here and
resumes it there from the archived checkpoint.

### Projects and Clones

A Project is its normalised remote, in exactly one Space. A Clone is
(project, device, path). Adding a folder whose `origin` matches an existing
Project makes a Clone of it. A repository without a remote is bound to one
Device for good. Flows and schedules are Night Shift data, not files in
the repository: the Space that keeps the Project keeps them as Yjs
documents, and every Device of the Space holds a copy (ADR 2). A Schedule
may name the Device that fires it. Without one, the Host of its Space
fires it, once (ADR 1). When a Device joins its Home Host, a remote that
both sides have becomes one Project with a Clone per Device (ADR 1).

### Worktrees and the Hand-off

One worktree per Device a Run's steps touch, all on `nightshift/<run8>`.
Between two steps on different Devices: push, fetch and checkout,
`HandedOff` logged. A dirty tree at the hand-off is decision 3.

### Recovery

- Placed Device offline when a step must start: the step sleeps with reason
  `device-offline`, woken when it reconnects.
- Placed Device offline during a step: its daemon keeps the session and
  buffers events; the Walker reattaches, or resumes with the harness
  session id (`continue, with-session`).
- Walker offline during a remote step: the placed Device keeps running;
  the Walker's recovery asks it before re-running.
- Host offline: every Device keeps walking its own runs on its Replica.
  Cross-device steps wait. Sync catches up.
- A Device that cannot reach anyone for long aborts its sessions. The
  limit is a Device setting.

### The relay

In the Host's daemon: Hocuspocus for the documents (`onAuthenticate`
resolves the Device key to its owner and the documents that owner may
open), and oRPC procedures, all called outbound by Devices: `sync.pull`,
`sync.push`, `sync.stream`, `archive.put`, `archive.get`,
`archive.follow`, `archive.tail`, `devices.work` (bodies and their event
streams between Walker and placed Device). The Host never calls into a
Device.

### Live transcripts

A person who watches a running step of a run another Device walks sees
its transcript grow as the Walker writes it, as for a run walked here.
The Walker sends a step's entries only while someone follows that step:
first everything up to now, then each new entry. Nobody watching, no
extra traffic: the run history and the archive copy at the step's end
travel as before.

- **One feed per step.** Every Replica answers the same call,
  `follow(step, afterSeq)`: the step's transcript entries after
  `afterSeq`, first what was written, then each entry as it is written,
  ending when the step ends (`packages/devices/src/exchange/feeds.ts`).
  Where the entries come from depends on who walks the run:
  - this Replica walks it: its own file, then its bus;
  - this Replica keeps the Space (it is the Host) and a Device walks it:
    the Host's tail of the step, which the Walker fills on demand;
  - a Host keeps the Space: that Host's feed over the link
    (`archive.follow`, an oRPC event iterator), which is one of the two
    cases above there.
- **The cursor is the entry's `seq`.** It grows by one per entry of the
  run. Every receiver drops an entry at or below the last `seq` it has,
  so a resend is harmless, and a viewer that reconnects with its last
  `seq` gets what follows, with no duplicates and no gaps. Command output
  is transcript entries too (`command-output`), so a running command's
  log travels in the same feed; its `.log` file goes to the archive at
  the step's end, as before.
- **Demand rides on the existing stream.** The Host keeps a tail per
  followed step, in memory, from the step's first entry. The steps a
  Walker should send, each with the `seq` to send from, are in every
  `sync.stream` batch for that Walker (`follows`, beside its commands).
  The stream sends a batch when that set changes, and the whole set on
  every (re)connect. The Walker starts a pump for a step new in the set
  and stops the pump of a step that left it; a stream that drops stops
  them all. A pump reads the step's file after the `seq`, then its bus,
  and pushes what it has to `archive.tail`, one batch at a time, again
  until the Host takes it. When the step ends, it pushes the rest with
  `ended`. The Host takes a push only from the run's Walker, in a Space
  its Person is a Member of (the rule of `archive.put`).
- **Nobody follows, nothing moves.** The first follower of a step puts it
  in its Walker's set. When the last follower leaves, or its connection
  drops, the step leaves the set and the Walker stops sending. The Host
  keeps the tail five more minutes, so a viewer that comes back is
  served from it and the Walker sends only what is new. An ended tail
  goes when its last follower has read it.
- **The archive stays the truth.** At the step's end the Walker puts the
  whole transcript and command log in the archive, as before. A step that
  ended is read from the archive; one whose copy has not landed yet comes
  from its Walker. Live entries are a cache: they are never written to
  the archive, and a Host that restarts loses them (its followers
  reconnect, and the Walker sends the step again from its start).
- **The run page.** `runs.watch` of a run walked elsewhere goes through
  its steps in the order they opened: an ended step from the archive, a
  running one from its feed, the next one when the feed ends. When a
  step has ended and its feed stays silent (a Walker of an older version,
  a Host away), the archive copy takes its place once it lands. The web
  run view is unchanged: it gets transcript entries on the same stream as
  for a run walked here.
- **Who may follow.** As for `archive.get`: a Member of the run's Space,
  in any role (a viewer reads). The local UI watches runs of the
  session's active Space only. A transcript entry holds no path of the
  Walker's disk (its file path is in the step row, which
  `withoutPrivatePaths` blanks).
- **No new channel, no new library.** The demand rides on `sync.stream`,
  the entries on two oRPC procedures under the `archive` permission. Yjs
  stays with the documents: a transcript is a log, which it does not fit.
- Tests: `packages/devices/src/exchange/feeds.test.ts` (three Replicas and
  a fake link, through the feed's interface: catch-up then live, two
  followers on one pump, the last follower leaving stops the Walker's
  pushes, a reconnect from its cursor without duplicates or gaps, the
  step's end closes the feed, a push of another Device is dropped);
  `packages/devices/src/exchange/live-watch.test.ts` (the run page of a run
  walked elsewhere shows a running command's output);
  `packages/devices/src/exchange/host-exchange.test.ts` (the Walker's stream
  names a followed step, only the Walker pushes, a non-Member is
  refused); `apps/server/test/devices/live-transcripts.test.ts` (two
  daemons: each watches a running step the other walks, and a viewer
  resumes from its cursor).

### Connectivity

Three questions, kept apart: how a Device finds its Host (addressing),
how the bytes get there through NAT (reachability), and whether Devices
need to talk without the Host (peer to peer).

**Addressing: a Host has several addresses, a Device falls through them.**
A Host advertises every `https://` name it has in the Space document, in
order of preference: a LAN name (`studio.local`, found by mDNS), a tailnet
name (`studio.tail1234.ts.net`), a public name
(`nightshift.example.com`). A Device tries them in that order and keeps
the first that answers, so at home it talks on the LAN, in the tailnet it
stays private, and from a café without the VPN it uses the public name.
The join URL is any one of them; after pairing the Device learns the rest.
Night Shift never needs to know how a name resolves.

**Reachability: the Host's way out is a deployment choice.** Three are
documented and tested; Night Shift ships none of them.

| Way out | When | Gives | Mind |
| --- | --- | --- | --- |
| A public server (a VPS, Dokploy) with a domain and automatic TLS | you already run a server | a public name for browsers and Devices alike | the Host operator reads what it archives, as always |
| A tailnet: Tailscale Serve for Devices in the tailnet, Tailscale Funnel to publish the same Host to the public internet | a home Host, no port to open | a tailnet name with a Let's Encrypt certificate; Funnel adds a public name on 443, 8443 or 10000 | Funnel is beta, bandwidth-capped, and does no login check of its own: Night Shift's auth stands alone there |
| An outbound tunnel: Cloudflare Tunnel (with Access in front if wanted), or self-hosted frp or rathole on a VPS | a home Host without Tailscale | a public name on your own domain | one more daemon on the Host |

All three end in an `https://` name, so to Night Shift they are the same.
A Host with no name at all stays on localhost: a single-Device Night
Shift, which is today.

**Peer to peer: not now, and not our own signalling.** Direct
Device-to-Device links would let two Devices sync and run cross-device
steps while the Host is down, and keep LAN traffic local. They cost a
second identity (node keys next to Device keys), a NAT-traversal stack,
relays for the hole punches that fail, and they do nothing for a browser,
which still needs an `https://` Host. The transport is therefore a port,
`Link`, with one adapter in the first slices: `httpsLink` (oRPC plus the
Hocuspocus WebSocket over one TLS connection). The adapter to add later is
**iroh**, not a signalling app of our own: iroh 1.0 (2026-06) dials by
public key, brings its own relays and discovery, and has npm bindings
(Node 20+, prebuilt, macOS arm64 only; Bun untested). A Device key is
already a key pair's worth of identity, so "dial the Device" fits. LAN
discovery by mDNS is the small first step on that road, and does not need
iroh.

### What moves in the UI

| Page | Change |
| --- | --- |
| Sidebar | A Space switcher (the session's active organization). Personal first. |
| Settings → "This computer" | This Device's entry on the Devices page: home Host, guest Hosts, "Be a Host". |
| Devices | Mine, with everything; the Space's, with name, online, Clones of its Projects and Offers. Pair a Device: the code to approve. |
| Agents | My Devices' profiles, tools, connections. An "Offer to a Space" action on a profile. |
| Projects | Per Space. A Project shows its Clones per Device. "Move to Space". |
| Members (new) | The organization plugin's members, roles and invitations, per Space. |
| Flow editor | A Device field on Agent, Command, Tool, Decision and Value nodes, listing my Devices and the Space's Offers. |
| Start run | Walker and worktree Device. |
| Run page | Walker, each step's Device and Person, Hand-offs, "Move to…". |
| Inbox | Gates of every Space I am in. |

### What moves in the data

| Where | Change | Owner |
| --- | --- | --- |
| auth tables | organization, member, invitation, apiKey, deviceCode (plugins' migrations) | the Host |
| `space_id` | on project, run, step, event, clone, offer; the tenant id | — |
| `device` | id, owner, name, platform, home host, last seen | the Device |
| Device document (Yjs) | facts, binary paths, session cap, profiles, CLI tools, connections, offers | the Device |
| Space document (Yjs) | projects, clone existence per device, offers, member mirror | Members / offering Devices |
| `project` | `space_id`, `remote`; `repo_path` and its unique index go | any Member |
| `clone` | project, device, path | the Device |
| `offer` | device, profile, space, permission cap, session cap | the Device |
| `run`, `step`, `event` | `space_id`, `walker_id`, `device_id`, `started_by`; `seq` per Walker | the Walker |
| `sync_cursor` | per Host, Space and owner: the last seq seen | the Device |
| archive | checkpoints and transcripts per Space | the Host, copies only |
| events | `StepStarted` gains `deviceId`; new `DeviceJoined`, `DeviceRevoked`, `DeviceOnline`, `DeviceOffline`, `HandedOff`, `WalkerMoved`, `MemberJoined`, `MemberRemoved`, `OfferMade`, `OfferWithdrawn`. Existing payloads keep their fields. | |

## Slices

The *Landed* notes below are history: each one says what a slice built
when it landed. Some names changed since, and the notes use today's.
The ADR table of `docs/steering/TECH.md` says why each one changed.

- `checkWork`, `admitWork`, `serveChecked` and `offeredDevice` are now one
  Offer admission (`createOfferAdmission`, `packages/devices/src/offers/admission.ts`):
  `OfferAdmission.serve` for a call over the wire, `OfferAdmission.deviceFor`
  for a run this computer walks itself.
- `WorkServer.withdrawn` is `OfferAdmission.withdrawn`, over the calls
  under each Offer (`OfferUse.calls`).
- `place` is the planner (`PlacementPort.plan`, and `moveTo` for a move).

1. **The seam and the Owner rule.** The Device port with the local
   adapter. Projects by remote with Clones. `event.seq` per Walker. One
   Device row. No behaviour change.

   *Landed (the Owner rule in the data):*
   - **One Device row.** `device` (id, name, platform, home host, last
     seen, created at, `self`). The row with `self` set is this computer;
     a partial unique index allows one. `self` is the Replica's own fact:
     a Device row that sync brings in never has it. The migration makes
     the row (a random UUID) so it can stamp the old rows in SQL;
     `selfDevice(db)` (engine) returns `{ id, name }`, makes the row in a
     database without one, and fills a blank name from the host name
     (without `.local`) and the platform. The daemon passes its id to the
     engine as `walkerId`.
   - **Projects by remote, with Clones.** `project.remote` is the
     normalised `origin`: `host/path`, no scheme, user, password, port or
     `.git`, host in lower case, path as is (`git@github.com:acme/app.git`
     and `https://github.com/acme/app` are `github.com/acme/app`). A path
     or `file:` remote is none. `repo_path` is gone; `clone` holds
     (project, device, path), unique per (device, path) and per (project,
     device): a Device has at most one Clone of a Project, so "this
     computer's folder" of a Project is one path. The engine's `Project`
     keeps `repoPath`, resolved from that Clone, and gains `remote`.
   - **Adding a folder:** a Clone here at that path gives its Project; else
     a Project with the folder's remote gets a Clone here (`CloneAdded`);
     else a new Project. A second folder of a Project that already has a
     Clone here is refused while the first folder exists; when the first
     folder is gone, or the Project was removed, the Clone moves to the
     new folder.
   - **Remotes of old rows.** SQL cannot run git, so the migration leaves
     `remote` null and gives every project a Clone here at its old path.
     The engine reads the `origin` of every Project here without a remote
     when it starts (`readRemotes`). A remote that another Project already
     has stays off: two clones of one repository that were two Projects
     stay two.
   - **`(walkerId, seq)`.** `event.seq` stays this Replica's local
     autoincrement: the read model, the run log and the stream cursors
     order by it, unchanged. Identity is the new `(walker_id, walker_seq)`,
     unique: the Walker that wrote the event and its own count, 1, 2, 3…
     `appendEvent` takes the count in its insert statement
     (`max(walker_seq) + 1` for that Walker), so two appends cannot share a
     number. A fact of no run (a project, a schedule) is written by this
     computer and counts in its sequence. Old events got `walker_seq = seq`.
     The sync cursor of slice 4 is "Walker X after `walker_seq` N".
   - `run.walker_id` (no foreign key: a run walked elsewhere may arrive
     before its Device) and `step.device_id` are this computer for every
     run and step today. Run bundles are written in format 2 (the
     project's Clones, the Walker columns). Format 1 bundles still open:
     the old `repo_path` reads as the project's one Clone, the remote as
     none, and the Walker and step Device as `unknown`.

   **Landed (the Device port):** `packages/engine/src/device/`.
   `types.ts` is the port, `local.ts` is `localDevice`, wired in
   `createDaemon` (`packages/daemon/src/daemon.ts`). Choices where this file was open:
   - `capabilities(query?)` takes the programs to look up
     (`{ programs }`), so a run start asks for the CLI tools its nodes
     name. A kind says which with `NodeKind.programs`. Requirements read
     the `Capabilities` data, not functions.
   - `session` streams `ready` or `refused` first. The engine records
     `SessionStarted` between that and the harness start, so a session
     that cannot start writes no session, as before.
   - The Device fills `${NAME}` and adds the CLI tool help. The input
     carries connection names and the node's servers as written.
   - `exec` streams output and one `exit`. The Walker writes the command
     log and cuts `log_tail` (`runCommand(device, …)`).
   - `decide` takes a decision or a value (overloads). The default models
     come from `capabilities().decider.defaultModels`, so the transcript
     names the model before the Device is asked.
   - `callTool` answers once. The transcript gets the call and the answer
     together when the tool answers.
   - `worktree` adds the run's worktree. The git work of a Call with
     `each` (its item branches) and its glob source stay on the Walker
     until placement (slice 5).
   - The engine takes one `device`. `deviceFor(node, run)` always gives
     it. Agent Profiles stay on the engine (`profileFor`): a run resolves
     them at start, before placement.
   - `StepStarted` gains `deviceId`, and `step.device_id` is the same:
     the Device the step runner placed the step on, not the Walker.
     `createDaemon` (`packages/daemon/src/daemon.ts`) builds `localDevice` from the self `device` row.
2. **Spaces.** The organization plugin; every row gets a `space_id`; one
   personal Space holds everything; the Space switcher shows one. Sessions
   on the procedures replace public ones. No behaviour change for one
   person on one computer.

   *Landed (Spaces):*
   - **Spaces are organizations.** `packages/auth` adds Better Auth's
     organization plugin. `spaces/roles.ts` holds the statements and the four
     roles of "Roles and permissions". The roles also keep the plugin's
     own statements (`organization`, `invitation`, `member` create,
     update, delete), because the plugin's endpoints check those. Custom
     roles (dynamic access control) are not on yet.
   - **A personal Space per Person.** `organization.personal` is a column
     (an additional field that a client cannot set). Its slug is
     `personal-<user id>`. A new Person gets one in the user-create hook.
     The hooks refuse an invitation to it, a member added to it, and its
     deletion. A new session starts in it. A session whose active Space
     the Person is no longer a member of works in the personal Space.
   - **The Person of this computer.** `device.owner_id` is the Device's
     Person. The migration names the earliest account, else it makes one
     (`local@nightshift.invalid`). Night Shift fills a blank name from the
     computer's account name when it starts, and `localPerson` makes a new
     Person for a database whose Person is gone.
   - **Backfill in SQL.** The migration makes the personal Spaces and
     their members in SQL, and puts every existing row in the personal
     Space of this computer's Person. So `space_id` is `NOT NULL` from the
     start. After the migration, the hooks make personal Spaces.
   - **`space_id`** is on project, clone, run, step, agent_session and
     event, without a foreign key (like `walker_id`). It is not on the
     Device's configuration (settings, profiles, CLI tools, connections,
     secrets): that is the Device's, not a Space's. LangGraph checkpoints
     have none: only their run reaches them.
   - **The engine's shape.** `createEngine` returns `Engine`, whose one
     method is `space(id)`: a `SpaceEngine`, the interface the API calls.
     Every method of it reads one Space. A project or run of another Space
     is "not found", the same answer as one that does not exist. The walk,
     recovery and the scheduler run over every Space. A run takes its
     project's Space; a step and a session take their run's; an event takes
     its run's, or for a fact of no run its project's, in the insert
     statement itself.
   - **A project is in one Space.** The remote stays unique on a Replica.
     A folder whose Clone or remote is a project of another Space is
     refused ("This folder is a project in another Space"). "Move to
     Space" comes with sharing.
   - **Sessions on the procedures.** Every procedure but the health check
     needs a session in a Space. A write needs a permission, checked on
     the server with the plugin's `hasPermission`: `project.add` and
     `remove`, `run.start`, `stop` and `resume`, `gate.resolve`,
     `signal.send`, and `run.export` on `/api/runs/:id/export`. Reads (runs,
     Gates, projects, the run stream) need membership only. This
     computer's configuration (settings, harnesses, profiles, connections,
     CLI tools, deciders, the folder picker, the git fixes, and the flow
     and schedule files in its Clone) is its owner's.
   - **The local session.** One person on one computer signs in to
     nothing. A request without a session, from a loopback address, with
     no `Origin` or one of Night Shift's own, gets a real Better Auth
     session of the computer's Person: the daemon adds its signed cookie
     to the request's headers, also for Better Auth's own endpoints. Every
     other request needs its own session. A page of another site in the
     same browser does not get the local session, and neither does a
     request from another computer (a daemon on `0.0.0.0` answered those
     before).
   - **Run bundles** are format 3: `space_id` on every row. Formats 1 and
     2 open with the Space `unknown`. An export reads the session's Space
     only.
   - **The Space switcher** is the sidebar header (the team switcher of
     `sidebar-07`): the Person's Spaces, personal first, shown as
     "Personal". `spaces.switch` sets the session's active organization;
     the app then goes home and reloads every query.
3. **The documents.** Device and Space documents in Yjs, persisted in the
   Replica; Hocuspocus in the daemon, verified on Bun. The Agents page
   grouped by Device.

   *Landed (part A, the Device document):*
   - **One Yjs document per Device**, `device:<id>`, opened by
     `openDeviceDocument` (`packages/engine/src/device-config/device-document.ts`). Its
     maps: `profiles`, `cliTools`, `connections` (name → plain JSON entry
     with `updatedAt`), `settings` (key → saved value), `facts`, `offers`
     (empty until slice 6) and `meta`. An entry is plain JSON, so an edit
     of one profile replaces that profile: concurrent edits of two fields
     of one profile keep one of them. A store parses each entry when it
     reads it; an entry it cannot read is skipped and stays.
   - **Facts** (`DeviceFacts`): platform, each added harness and where its
     CLI is, the programs on its PATH, the names of the secrets in its
     keychain, its Clones, `checkedAt`. The Owner writes them at start and
     every ten minutes (only what changed); the connection store writes
     the secret names when a secret is saved or removed. Secret values
     never enter the document.
   - **Persisted in the Replica**: `ydoc(name, state, updated_at)`, the
     full state (`Y.encodeStateAsUpdate`) after every change, one write at
     a time; a store's `save` resolves when the row is written. A clean
     stop (signals, the desktop app's stop) flushes the pending write.
   - **The stores are views of the document**, interfaces unchanged:
     `createProfileStore`, `createCliToolStore`, `createConnectionStore`,
     `createSettingsStore` take `{ document }` instead of `{ db }`. `load()`
     has nothing left to do; a remote edit shows in the next read.
   - **Import once.** On the first start without the document's
     `meta.importedAt`, the rows of `agent_profile`, `cli_tool`,
     `connection`, `setting` and `secret` (its names become
     `facts.secrets`) are copied in, in one transaction. The tables stay,
     read-only, with a comment in the schema: SQL cannot write a Yjs
     document, so the migration cannot move the rows, and dropping the
     tables in this slice's migration would lose them before the import
     runs. A later migration drops them, once every install has started
     this version.
   - **Hocuspocus in the daemon** at `/sync` (`packages/daemon/src/sync/sync.ts`).
     Bun accepts the socket (the daemon's default export is `{ fetch,
     websocket }`) and hands it to Hocuspocus 4's `handleConnection`. The
     daemon is the Owner of the documents it serves, so Hocuspocus gets no
     persistence extension: on load it takes the Owner's state, and every
     update goes both ways (origin-tagged, so none echoes) until it
     unloads the document. The database extension (`fetch`/`store` over
     `documentRows(db)`) is for a Host that keeps documents it does not
     own: slice 4.
   - **Who may connect**: the Device's owner only, by the same rule as the
     procedures (`ownerOnly`, `packages/auth/src/access/document-access.ts`). The request's
     session decides; a request from this computer (`isThisComputer`: a
     loopback address, no `Origin` or one of the UI's) without a session
     of its own gets the local Person's session, as slice 2's procedures
     do. The session's Person must be the Device's owner, and the document
     one this daemon owns. The seam is `SyncAuthorize({ documentName,
     token, peer, request })`: slice 4 adds the Device key (its owner) and
     the home-Host rule.
   - **`bun --hot`**: the document and the relay are kept across reloads,
     and a store's view registers nothing on the document (`mapView`
     compares a per-map revision the document counts), so building the
     stores again leaves nothing behind.
   - **The Agents page** shows profiles, harnesses, tools and secrets under
     this Device's name, with "This computer" beneath it.
   - Not yet: the Space document (part B), a UI that syncs the document
     live (the UI still reads and writes through oRPC; the Owner applies
     those writes to the document).

   *Landed (part B, the Space document):*
   - **One Yjs document per Space**, `space:<id>`, in `ydoc` like the
     Device document (`packages/engine/src/projects/space-document.ts`; both open
     through `openPersistedDocument`, `packages/engine/src/device-config/ydoc.ts`). Its
     maps: `projects` (id → name, remote, created, removed, updated),
     `clones` (`<project>/<device>` → that the Device has a Clone, and
     since when), `devices` (id → name, for the Devices with a Clone),
     `offers` (empty until slice 6), `members` (user id → name, role) and
     `meta`. A Clone's path is never in it: it stays in the Device's
     `clone` row and its Device document.
   - **The document is the source, the rows its projection.** The
     Replica's `project` rows follow the document after every write, the
     in the same queue as the save
     (`projectSpace`): a new entry makes a row, a changed one updates
     name, remote and removed. Engine queries stay in SQL. A projection
     never deletes a row and never takes a row of another Space (only a
     move changes a Project's Space); an entry the rows refuse (a remote
     another Project has) is skipped and tried again on the next write.
     `clone` rows stay the Device's own: SQL holds this Device's Clones
     with their paths, the document holds every Device's without.
   - **Import once.** The first open of a Space's document copies that
     Space's `project` rows and its Clones' existence in, and records it in
     `meta.importedAt`. The daemon and the engine open the document of
     every Space the Replica knows at start (`openAll`: each organization,
     and each Space a project row names) before the relay serves them.
   - **The engine writes the document.** Adding a Project defines it in
     the document first; its row follows before the call returns. Restore,
     remove, rename and `readRemotes` change the entry, not the row. A
     Clone added here is a `clone` row and a `clones` entry. An entry the
     document lacks (a row from before it) starts from the row. New
     events: `ProjectRenamed` and `ProjectMoved`. The engine logs the facts
     it makes, and nothing else writes the document.
   - **Members mirrored from auth.** On open, and from the organization
     plugin's hooks (a Space made, a Member added or removed, a new role,
     an invitation accepted: `createAuth(…, { onMembersChanged })`), the
     Space's `member` and `user` rows are written into `members`.
   - **Who may open it** (`documentAccess`, `packages/auth/src/access/document-access.ts`,
     which `ownerOnly` became): `device:<id>` its owner, as before;
     `space:<id>` a Member of that Space, by the same session rule, always
     read-only (Hocuspocus's `connectionConfig.readOnly`: it drops the
     client's updates). Anyone else is refused. The authorize function
     returns `SyncAccess` (`"write"`, `"read"` or `false`).
   - **Writes to a Space document go through the procedures.** A Yjs
     update is a merge of bytes, not an action: the relay cannot tell a
     rename from a removal, so it cannot check `project.remove` or log
     `ProjectRemoved`. The procedures can: they check the role with
     `hasPermission`, the engine writes the document and logs the event,
     and the relay carries the change to every Member. Slice 6 lets
     colleagues in, so no Member writes a Space document directly.
   - **Create Space** (`spaces.create`, the Space switcher): the
     organization plugin's `createOrganization`, slug `<name>-<8 hex>`, the
     creator its owner, and the session's active Space. The hook opens its
     document. The personal Space stays closed to others (slice 2's hooks).
   - **Move to Space** (`projects.move`, the project card's menu): needs
     `project.move` in both Spaces (`can(permissions, inSpace)`), and no
     run of the project running a step. One SQL transaction gives the new
     `space_id` to the project, its Clones, runs, steps, sessions and
     events (the runs' events, and the project's facts of no run by
     `payload.projectId`). Then the new Space's document gets the entry
     and its Clones, the old one loses them, and `ProjectMoved` (`from`,
     `to`) is logged in the new Space. The rows and the documents are not
     one transaction: a stop between them leaves the entry in the old
     document, whose projection cannot take the row back.
   - **Projects per Space** show their Clones: the engine's `Project` has
     `clones` (Device id, its name from the document, `thisDevice`). The
     project dashboard lists them: "This computer", then other Devices by
     name (none until slice 4). A project can be renamed from its card.
4. **A second Device.** Pairing by device authorization; the event log
   exchange; the archive; inbox and runs from both Devices on both.

   *Landed (part A, pairing a Device with a Host):*
   - **Host role.** "Be a Host" (`host`), the Host's addresses
     (`hostAddresses`, ordered, `https://`; `http://` on loopback for
     tests and development) and `deviceKeyIdleDays` (default 30) are
     settings in the Device document, with `NIGHTSHIFT_HOST` and
     `NIGHTSHIFT_HOST_ADDRESSES` as fallbacks. A daemon binds `127.0.0.1`
     until it is a Host with an `https://` address, then `0.0.0.0`
     (`reachFor`, read at start: the Devices page says when a restart
     applies a change). The desktop app binds the same. `127.0.0.1`, not
     Bun's `localhost` (which binds `::1` only): `127.0.0.1` callers reach
     it, and `localhost` callers (curl, browsers, Bun's fetch) fall back to
     it. Bun's WebSocket does not fall back, so the Link dials `127.0.0.1`
     for a `localhost` Host. Not a Host: no
     pairing, no Device key accepted (`hello` answers "not a Host", which
     a Device treats as offline, not as revoked).
   - **Certificates.** A Host behind an authority's certificate (Tailscale
     Serve, a proxy, Cloudflare) needs nothing. A daemon serves `https://`
     itself with `NIGHTSHIFT_TLS_CERT` and `NIGHTSHIFT_TLS_KEY`. A
     self-signed certificate is pinned: the joining Device reads it with
     a TLS handshake, prints its SHA-256 fingerprint with the code, the
     Host shows the fingerprint of the certificate it serves in "Pair a
     device" and on its Devices page, and the Device keeps the
     certificate in `host_link.certificate`. Bun 1.3's `fetch` and
     `WebSocket` never call `checkServerIdentity`, so the pin is the
     certificate as the only authority (`tls: { ca }`): a changed
     certificate fails the link (`packages/devices/src/reach/tls.ts`). A
     certificate this computer already trusts is not pinned (renewals).
   - **Pairing** (`packages/auth/src/pairing/pairing.ts`): Better Auth 1.7.7's
     device authorization plugin, client id = the joining Device's id,
     codes valid 15 minutes, polled every 2 s. Reviewing a code binds it
     to the Person who entered it; another Person cannot review, approve
     or deny it (tested: CVE-2026-45337). The plugin's session token from
     `/device/token` is deleted at once: the Host answers the redeem with
     a Device key instead. The Device's name and platform are kept in
     memory with its pending code (a Host restart forgets them; the code
     still works, the Device shows as "Device").
   - **Device keys** (`packages/auth/src/device-keys/device-keys.ts`, the API key
     plugin): prefix `nsd_`, bound to the approving Person, metadata
     `{ deviceId }`, permissions `sync`, `relay`, `archive`, hashed at
     rest, rate limit off. Idle expiry: a use moves `expiresAt` on, at
     most once a day. Pairing again replaces the Device's key.
   - **On the Host** (`packages/devices/src/host/host.ts`, the registry
     `packages/devices/src/registry/registry.ts`): the paired Device's
     `device` row (name, platform, owner, `home_host` = the address it
     joined by when this is its home Host, else null, `last_seen_at`,
     new `revoked_at`), and `DeviceJoined`, `DeviceRevoked`,
     `DeviceOnline`, `DeviceOffline` in the owner's personal Space (a
     fact of no run names its Space: `EventInput.spaceId`). Online is
     derived: a heartbeat within 45 s. A Host that starts again logs
     `DeviceOffline` for a Device the log left online. Remove access:
     the key goes, `DeviceRevoked`, and the relay closes the Device's
     sockets (`sync.disconnect`, on the connection context the authorize
     hook returns).
   - **Device-key auth.** A procedure call with `Authorization: Bearer
     nsd_…` is a Device: no session, never the local session, even from
     loopback. The Host's contract names the permission each procedure
     needs (`sync` for `link.hello`, `link.heartbeat`), and `hostRouter`
     checks it (`packages/devices/src/host/router.ts`); `pairing.start`
     and `pairing.redeem` need no key.
     On the relay, `documentAccess` takes a Device key as the provider
     token (`deviceKey` → `{ deviceId, personId, home }`): it opens the
     Device's own document, only on its home Host and only for the
     document's owner, to write; and the Space documents of the Spaces
     its Person is a Member of, to read. Any other document is refused,
     the Host's own Device document too. A Host keeps the
     Device documents of its home Devices (`KeptDocuments`: Hocuspocus
     loads and stores them in the Replica's `ydoc` rows); a guest Host
     keeps none, and refuses them.
   - **The joining Device** (`packages/devices/src/links/join.ts`, `bun run
     join <host> [--guest]` → the local daemon's `devices.join`, a
     stream): the link goes in `host_link` (Host id and name, addresses,
     pinned certificate, home or guest, the Person there, where the key
     is), its key in the keychain (`Bun.secrets`, service
     `nightshift-device-keys`), else in `<data dir>/device-keys/<host>`
     with mode 0600 (`NIGHTSHIFT_KEY_STORE=file` forces it). One home
     Host at most; a home link sets the self row's `home_host`.
   - **The Link** (`packages/devices/src/links/link.ts`): `httpsLink` tries
     the addresses in order (a refusal is an answer, a network error
     falls through), keeps the first that answers, learns the Host's
     list from each answer (the Host's order, then the ones it did not
     name), heartbeats every 15 s, backs off 1 s doubling to 60 s, and
     over a link to the home Host syncs this Device's document with the
     Hocuspocus provider. A refused key ends the link (`revoked`, key
     deleted). When the relay closes the socket it heartbeats at once, so
     Remove access ends the link in a moment.
   - **The Devices page** replaces Settings → "This computer" (Settings
     links to it): this computer (name, Be a Host and addresses, where
     its access to Hosts is saved, data folder), "Your devices" (online or
     last seen, Remove access) and "Hosts of this computer" (home or
     guest, status). "Pair a device" takes the code (Input OTP), shows
     the device and the fingerprint, and allows or declines it. The code
     link the CLI prints opens it filled in (`/devices?pair=`).
   - `BETTER_AUTH_URL` and `CORS_ORIGIN` are not sensitive in
     `.env.schema`: varlock refused responses that carried them.
   - Tests: `apps/server/test/devices/two-devices.test.ts` runs two
     daemons as processes (the services are one per process), B joins A
     through the CLI, A's Person approves, B is online on A, B's document
     opens on A, Remove access ends B's link, and A's log has the four
     events.
   - Not yet (part B): `sync.pull`/`push`/`stream`, the archive, the
     Space document on a Host, an mDNS name, listing a guest Host's
     Spaces. Joining from the desktop app's UI calls the same
     `devices.join`. A Person removing their own home link, and moving a
     home, need a UI.
   *Landed (part B, the event log exchange and the archive):*
   - **What moves.** Runs, steps, agent sessions and the events of runs:
     the Walker's rows. Facts of no run (a project's, a schedule's, a
     Device's) stay on the Replica that wrote them; the Space document
     carries the Space's definitions. The merge is a union: an insert
     skips a row the Replica has (`(walker_id, walker_seq)`, row ids), and
     nothing is updated across Devices. The one column that changes after
     its insert, `agent_session.harness_session_id`, is the Walker's copy
     of its `HarnessSessionAssigned` event: a receiver fills it from that
     event. A batch carries its events in the order they landed on the
     Replica that serves it (its `seq`: each Walker's in its own order,
     and a moved run's old Walker before its new one) with the run, step
     and session rows they name, so parents go in first and the foreign
     keys hold. A batch lands in one transaction, and what follows from it
     is read from the log (see "Run-history ingest" below). The engine
     owns those rows: it reads and adds them
     (`packages/engine/src/log/history.ts`), and both halves of the
     exchange call it through one module
     (`packages/devices/src/exchange/run-history.ts`).
   - **Cursors** (`sync_cursor`): per Host, Space and Walker, the last
     `walker_seq` this Replica has. Finer than "per Host and Walker", so a
     Space the owner joins later is exchanged from its start. For this
     computer's own Walker the row is the push cursor: what the Host took.
   - **Run-history ingest** (`RunHistoryExchange`,
     `packages/devices/src/exchange/run-history.ts`): the one module the
     Device's half and the Host's half go through. A batch lands in one
     transaction (`RunLog.ingest` runs one `db.batch`: the rows, the
     events, and the columns that follow from them). Everything that
     follows an ingest is read from the log, so a batch that comes again
     after a crash repeats it safely: the run's Walker (the `to` of its
     latest `WalkerMoved`) and a session's harness id, in the same
     transaction; a run that moved here, taken over until it arrived
     (`WalkerArrived`, the new Walker's first event there); a copy of a
     step reopened elsewhere, dropped. A Command's id is in the first event it writes, so the log
     is the dedup across restarts. The wire stays compatible both ways:
     `sync.commands` and the `commands: false` option of `sync.stream` are
     new and optional, and the order of a batch needs nothing of the
     receiver. Tests: `exchange.test.ts` ("a batch and what follows from
     it": a crash mid-batch, a third Replica, take-overs again and after a
     restart) and `device-exchange.test.ts` (a Command applied before a
     restart, Commands while the rows hang, a Host of an older version).
   - **Over the Link** (`packages/devices/src/exchange/device-exchange.ts`,
     run while the link is online): a push loop sends this computer's rows
     of the Spaces the Host keeps, after the cursor, whenever an event
     lands; a pull loop reads `sync.stream` (an oRPC event iterator: a
     batch, then every new one as rows land on the Host); a third loop
     reads `sync.commands`, the Commands for its runs, so they never wait
     behind rows. The run log ingests what arrives (`RunLog.ingest`, the
     same bookkeeping as an append) and the bus tells the run's watchers,
     so a run page of a run walked elsewhere updates live. `sync.pull` is
     the same batch once.
   - **The Host filters** (`packages/devices/src/exchange/host-exchange.ts`): it
     serves rows of the Spaces the key's Person is a Member of, never the
     Device's own back; it takes only rows whose Walker is the key's
     Device, in those Spaces, and refuses the whole batch otherwise
     (`FORBIDDEN`). Its own Walker's rows are served like pushed ones; its
     Replica keeps everything it receives.
   - **The Host's Spaces on a Device.** `link.hello` (and every heartbeat)
     lists the Spaces the key's Person is a Member of, with their role.
     The Device keeps them in `host_space`, with an `organization` row and
     a `member` row for its own Person in that role: this computer's
     Person acts there as its owner does on the Host, so sessions, the
     Space switcher and `hasPermission` work unchanged. A personal Space
     there is "Personal on <Host>", never this computer's personal Space.
     Their documents sync read-only over the link (one WebSocket per link
     for every document); the copy here is the Host's: no import, no
     member mirror. A batch whose project has not arrived waits for it
     (`MissingProjectError`) and goes again.
   - **Projects in a Space a Host keeps.** Adding a folder whose remote is
     one of its projects records the Clone through the Host
     (`sync.addClone`, which needs `project.add`), then the `clone` row
     here. A new project, a rename, a removal or a move there is refused
     on the Device: "change its projects there".
   - **Commands** (`run_command`, `packages/devices/src/exchange/commands.ts`). The Walker is
     the only writer of its run's events, so answering a Gate, sending a
     signal and stopping a run walked elsewhere is a command. The Replica
     that asks checks what it can first (the Gate is open, the choice is
     one of its choices, the run waits for that signal), then the engine
     hands it to its `Relay`: a Host keeps it for the Walker; a Device
     sends it to the Host (`sync.command`), which checks the role of the
     key's Person (`gate.resolve`, `signal.send`, `run.stop`) and applies
     it at once when it walks the run itself. The Walker takes its
     commands on their own stream (`sync.commands`; a Host of an older
     version sends them with the rows), checks again from its own Replica
     (the run is its own; the Space document's Member mirror gives the
     Person a role that allows it), applies it as the local action, and
     reports it (`sync.commandDone`, with its reason when it refused). It
     applies a command once: the first event the command writes to its
     run carries the command's id (`commandId`), so its log says which
     commands it applied, also after a restart. While one is applied it
     is noted in memory, also across a `bun --hot` reload
     (`AppliedCommands`), so a second stream waits for its result. A
     command for a run that is not walked here yet waits for the rows
     that move it here, and for the run's take-over. A command
     to an offline Walker waits; the run page, the inbox and the run
     header show it as sent ("Answer sent"). Pending commands are known
     where they wait: on the Host. A Device whose Host is offline refuses
     the action; there is no outbox.
   - **Read-only elsewhere.** Recovery, the daemon's resume and a
     person's resume touch only runs this Device walks. Every other
     action on a run walked elsewhere is refused. `RunSummary.walker`
     (`id`, `name`, `thisDevice`) names the Walker: its `device` row, else
     the Space document's Device names. The UI shows it on the runs list,
     the run page and the inbox; a run of another device has no take
     over, wake, resume or export, and its folder is not shown.
   - **The archive** (`archive.put`, `archive.get`, the `archive`
     permission; `packages/devices/src/archive/archive.ts`). After a pushed batch with a node
     that ended, the Walker puts that step's transcript and command log,
     and its run's latest checkpoint per namespace with its pending
     writes (JSON, blobs in base64). Rows first, then files, then the
     cursor: the Host takes files only of runs it has, from their Walker,
     in its Person's Spaces. Layout, the same on a Host and as a Device's
     cache: `<data dir>/archive/<space>/<run>/<step>.ndjson`,
     `<step>.log`, `checkpoint.json`. A transcript of a run walked
     elsewhere is read there, and fetched from the Host on demand when it
     is missing (kept once the step has ended); the Host serves its own
     runs from their own files. A transcript that lands tells the run's
     watchers. A running step of a run walked elsewhere is followed live
     while someone watches it (see "Live transcripts"); once it ended,
     the archive copy is the truth.
     Retention is undecided, as for run history: everything is kept.
   - **Host offline**: every Device keeps walking its own runs; both loops
     start again at their cursors when the link is back.
   - Tests: `packages/devices/src/exchange/exchange.test.ts` (two
     Replicas in one process) and `apps/server/test/devices/exchange.test.ts`
     (two daemons, the harness of part A in `test-daemons.ts`): B walks a
     run in A's Space, A gets it live with the same status and B's name,
     answers its Gate from A, B applies it and the run finishes on both, A
     opens the transcript from the archive; a Space B's owner is not in
     never reaches B; a forged row is refused; B walks while A is down and
     A catches up.
   - **A Walker's paths stay with its owner.** Where its worktree,
     transcripts and command logs are on its disk is private to the
     Walker's owner. The Host keeps them only from its own owner's
     Devices, and serves them only to a Device whose owner is the
     Walker's; every other Replica gets the rows without them
     (`withoutPrivatePaths`). The rows keep their shape, so old readers
     and the payload rule hold: `run.worktree_path`,
     `step.transcript_path`, `WorktreeCreated.worktreePath` and
     `StepStarted.transcriptPath` become `""`, and a `StepStarted.logPath`
     that was set becomes `""` (still "this step has a log"). Clone paths
     never leave their Device: `clone` rows and the facts of no run
     (`CloneAdded`, `ProjectAdded`) are not exchanged, and the Space
     document has none.
   - **Who started it.** `run.started_by` travels with the run row. A run
     this computer starts in a Host's Space names this computer's Person
     as the Host knows them (the Person of its link), so every Replica of
     the Space names the same Person; the git author stays the local one.
   - **Every project of a Space is listed**, also without a Clone here:
     `Project.repoPath` is null, and the UI says "Not on this computer"
     (slice 5 starts runs placed on another Device from anywhere). Every
     call that needs the folder (flows, branches, schedules, a run walked
     here, rename and removal) says "This project is not on this
     computer. Add its folder here to use it."
   - Not yet, and risky: a Person who leaves a Space keeps the rows they
     had. Pending commands show only on the Host. A run bundle of a run
     walked elsewhere has no transcripts. Transcripts in the archive are
     run content, readable by the Host's operator (as "What is
     deliberately not promised" says). The Members page should treat a
     Host's Space as read-only on a Device.

   *Landed (ADR 1, the documents of the owner's other Devices):*
   - **The Host lists them.** Over a home link, `link.hello` (and every
     heartbeat) has `devices`: the other Devices of the key's Person
     whose documents the Host keeps (home, access on), and the Host
     itself when that Person owns it. A Guest Host, and a Host of an
     older version, leaves it out. Never another Person's Device.
   - **Read-only on the relay.** `documentAccess` gives a Device key
     `"read"` on `device:<id>` of another Device of its Person, only on
     its home Host: a document the Host keeps for that Person, or the
     Host's own. Its own document stays `"write"`. A Device of another
     Person, and any Device over a Guest Host, is refused.
   - **A copy on each Device** (`createDeviceCopies`,
     `packages/engine/src/device-config/device-copies.ts`): a row of
     `ydoc` named `device-copy:<id>`, apart from the `device:<id>` rows a
     Host keeps, synced as `device:<id>` over the home link
     (`HttpsLinkOptions.deviceDocuments`). A Device the Host no longer
     lists loses its copy and stops syncing it; a home link that is
     revoked drops every copy. Nothing on the Device writes a copy, and
     its relay serves none.
   - **What a copy tells**: the Device's name (a new fact, `facts.name`,
     else the name the Host gave), platform, profiles, and the names of
     its saved secrets with when each was set. Secret values never enter
     a Device document (ADR 1, decision 3), so no copy has one. A copy
     also has the Device's Clone paths and settings: its owner's, like
     the rest of the document.

5. **Placement.** Run-level, then per node with the Hand-off;
   `device-offline` sleep and reattach.

   *Landed (part A, run-level Placement through the relay):*
   - **A run's Device.** `run.device_id` (nullable, no foreign key, like
     `walker_id`; null: a run from before it, on its Walker) is the Device
     its steps run on and its worktree lives on. `StartRunInput.deviceId`
     sets it; default this computer. `deviceFor(node, run)` returns it:
     `localDevice` for this computer, else `remoteDevice`. Per-node
     placement changes `deviceFor` only. `StepStarted.deviceId` and
     `step.device_id` record it per step, as before. Run summaries have
     `device` beside `walker`; steps have `device`. Exchanged run rows
     carry `deviceId` (a Device of a version before it sends none). Run
     bundles are format 5.
   - **The Device port grew** what a run on another computer needs:
     `capabilities()` is async and says whose they are (`elsewhere`: null
     for this computer, else the Device's name); `flows(projectId)` reads
     the Clone's flow files unparsed (`FlowSources`, plain JSON); `worktree`
     takes the project, not a path: the Device resolves its own Clone
     (`clonePathOf`) and checks the folder is ready (git, top level, a
     commit) before it adds anything, so the readiness check moved from
     `prepareRun` into `localDevice`. A Call's item branches
     (`itemBranch`) and its glob source (`files`) run on the worktree's
     Device too.
   - **`remoteDevice(relay, device, forRun)`**
     (`packages/devices/src/work/remote.ts`, its wire in
     `packages/devices/src/contract/work.ts`): every call is a
     `WorkRequest`, plain data: who asks and for which run (`WorkFor`:
     Space, project, the Person who starts or started the run as the Host
     knows them, the run, null before it exists) and the call without its
     signal. Replies are `WorkReply`: the items of a session or a command,
     one result, or an error. Aborting the caller's signal cancels the call
     on the Device. `serveWork(device, request, signal)` runs one on the
     placed Device's `localDevice`. A stream that ends without its last
     event becomes the step's end: `stopped` when this side aborted, else
     an error of kind `network` (the run's policy waits and continues the
     session, as for a network failure).
   - **The relay's work half** (`devices.work`, the `relay` permission of a
     Device key). On a Host, `createWorkHub` (`packages/devices/src/
     work/work-hub.ts`, in memory) holds the calls of the runs the Host walks,
     per placed Device. The placed Device takes them as a stream over its
     own Link (`createWorkServer`, `work.ts`, a stream of the Link beside
     the exchange's two): the Host never dials a Device. It answers with
     `devices.workReply`, a batch at a time (what accumulates while one is
     on its way). A cancel follows an abort. A Device whose stream drops
     keeps its calls for 45 s, then they end with "went offline"; calls
     made in that window wait for it. A Device that takes its work again
     names the calls it still serves; any other it took ended there (it
     restarted, or the call never reached it) and ends with an error.
     Replies that cannot reach the Host for a minute abort the call on the
     Device: nothing runs for a Walker that is gone.
   - **Two checks, two code paths.** The Host, before it places a run
     (`PlacementPort.plan`, then `place`, in `packages/devices/src/placement/`): the Device is paired here and not revoked,
     its owner is the Person who starts the run (another Person's Device
     is Offers, part B: "colleague-laptop is not your device."), it takes
     work now, and the Space document has its Clone of the project. The
     placed Device, for every call, from its own Replica
     (`OfferAdmission.serve`, then `checkWork`):
     the Space is one it takes part in through this Host; the Person is
     its owner as that Host knows them (`personOnHost`) with a role that
     allows `run.start` (the Space document's Member mirror, as commands
     check); it has a Clone of the project in that Space; a call that works
     in a folder works in the run's own worktree
     (`worktreeLocation(clone, run8)`), and `worktree` is for the run that
     asks.
   - **Who walks.** A run started on the Replica that keeps its Space is
     walked there, wherever its steps run. A Device whose Space a Host
     keeps walks a run it starts for itself; a run it starts for another
     Device goes to the Host (`sync.startRun`, `run.start` checked there)
     and the Host walks it; the Device returns once the run's rows arrived
     by the exchange. A schedule's run runs on this computer.
   - **Run start reads the placed Device**: its flow files, its
     capabilities (harnesses, connections, CLI tools, programs, decider),
     its Clone. Refusals name it: "The flow uses the CLI tool "gh" on
     hetzner-1, but that device does not have it. Install gh there, or
     choose another device." Agent Profiles stay the Walker's (resolved at
     start, as slice 1 decided); the profile's Device is part B.
   - **Placements** (`runs.placements`, `SpaceEngine.listPlacements`): this
     computer when it has a Clone, then the Person's paired Devices that
     are online with a Clone; a Device in a Host's Space asks the Host
     (`sync.placements`). The flows of a project without a Clone here come
     from the first other placement (read-only). Rename, move and removal
     of a project are the Space's: they no longer need a Clone here.
   - **UI.** Start run asks for the Device when there is a choice
     ("MacBook (this computer)", "hetzner-1"), this computer first; with
     none online it says so and does not start. The run page: "Runs on"
     (the run's Device), "Walked by" when that is another computer, "Ran
     on" per step. Take over shows only for a run whose steps run here.
     The runs list badges the run's Device.
   - Tests: `packages/devices/src/placement/placement.test.ts` (in-memory
     relay: the steps and worktree on B, a stop ends B's command, flows from
     B's Clone, rename and remove without a Clone, the refusals);
     `packages/devices/src/work/work.test.ts` (the work server, the hub;
     the checks are in `packages/devices/src/offers/admission.test.ts`);
     `apps/server/test/devices/placement.test.ts` (two daemons: A the Host
     without a Clone lists B's flows and walks a run whose command and
     fake Claude Code steps run on B, the events and transcript land in A's
     log, a stop on A kills B's session, another Person's Device is
     refused).
   - Not yet (part B): a node's own `device`, the Hand-off, the
     `device-offline` sleep and reattach (today: a call to a Device that is
     away ends the step), "Move to…", Offers. The hub forgets its calls
     when the Host stops; recovery then treats the run as interrupted.
     Only a Host's runs reach another Device: a `WorkRelay` from a Device
     through its Host (Walker → Host → placed Device) is not built, so a
     Device never walks a run placed elsewhere. The transcript of a run
     walked here is live wherever its steps run (the Walker writes it); a
     run walked elsewhere is live too (see "Live transcripts").

   *Landed (part B, per-node Placement, the Hand-off, offline, Move to):*
   - **A node's `device`** (`packages/flows`): a Device name on Agent,
     Command, Tool, and model Decision and Value nodes; a Gate, a rule or a
     timer that names one is a flow error ("Only a model runs on a
     device"). `deviceNameSchema`: 1 to 64 characters. The flow editor's
     Device section lists your Devices (`runs.devices`); a name that is not
     one of yours stays, marked.
   - **Where a step runs** (`packages/devices/src/placement/placement.ts`, one
     module for both halves): the node's `device`, else the profile's
     Device, else the run's Device, else the Walker. "The profile's Device"
     is the run's Device when it defines the profile, else this computer
     when only it does (`Capabilities.profiles`: a Device reports the
     profiles asked for). Run start resolves every name once, among the
     starter's own Devices (`run.placements`: `{ name: deviceId }`, bundles
     format 6; this computer by its name; two Devices of one name refuse),
     and writes this computer's name into a node it places there for its
     profile. `deviceFor` reads the node's name through `run.placements`.
     Every placed Device answers the requirements for its own nodes, and
     one whose nodes work in the worktree needs a Clone ("The flow runs node
     "x" on hetzner-1, but that device does not have this project").
     `NodeKind.works` says what a step needs: `worktree` (Agent, Command, a
     Wait on a command, a Call with each that branches or reads files or a
     command), `device` (Tool, a model), or nothing.
   - **The Hand-off** (decision 3). One worktree per Device a run's work
     reaches, all at `worktreeLocation(clone, run8)` on `nightshift/<run8>`.
     Before a step that works in the worktree, the step runner
     (`readyDevice`) compares its Device with the one that has the work
     (`deriveWorktrees`: the run's Device, then each `HandedOff.to`). When
     they differ, that Device's `handOff` refuses a worktree with
     uncommitted changes (the step fails: "The run's work on studio cannot
     move to hetzner-1. … has changes that are not committed (draft.txt).
     Night Shift does not commit for you …"), else pushes the checked-out
     branch and the run's own to `origin` (forced: they are the run's), and
     this Device's `receiveHandOff` fetches it and checks it out at that
     commit in its own worktree of the run (added when it has none, with
     the starter's git identity). The Walker logs `HandedOff` (from, to,
     commit, branch, worktreePath) and the step works there
     (`StepHandle.worktree`). The run page lists them ("Work moved").
     `HandedOff.worktreePath` stays with its owner, like the other paths.
   - **The Walker → Host → Device leg.** A Device that walks a run calls
     another of its Person's Devices through its Host: `devices.call`, a
     stream over its link (closing it cancels the call); the Host relays it
     through its hub, or serves it itself with its own `localDevice` when
     it is the Device (`OfferAdmission.serve`). `devices.reachable`
     says whether one takes work. `createWorkRelay` (`packages/devices`)
     picks the hub for a Space this computer keeps and the Host for the
     others. A
     Device in a Host's Space learns its Person's Devices from the Host
     (`sync.devices`). The Host still walks a run that a Device starts for
     another Device (part A); a run the Device starts for itself, with
     nodes placed elsewhere, is walked by the Device.
   - **`device-offline`.** A step that needs a computer, whose Device (or
     the Device that has the work) is offline when it must start, sleeps
     through the sleep module (`SleepRequest` kind `device`, reason
     `device-offline`, `WaitStarted.deviceId`) and looks again every
     minute; Command and Tool nodes got a wait node for it. On a Host, a
     Device whose link takes work again wakes those sleeps at once
     (`createWorkHub({ onBack })` → `Engine.deviceBack` of the newest
     engine, also after a `bun --hot` reload); a Device that walks through
     its Host has the minute only. Online now means a work
     stream is open; a call already made waits out a short drop (45 s).
   - **Offline during a step.** The placed Device keeps the session and
     its replies while they cannot reach the Host, up to ten minutes
     (`REPLY_DEADLINE_MS`), and sends them when the link is back: the
     Walker gets the events it missed (a short drop is a reattach). A call
     the hub ends because the Device stayed away (45 s) is an `offline`
     error: a session cut off that way ends with an error of kind
     `network`, so the run's policy waits (network grace) and continues it
     with the harness session id (`continue, with-session`).
   - **A Host restart**, precisely: the hub is in memory and forgets its
     calls. Recovery on the Host ends the open step `interrupted` and the
     daemon's resume (after its grace) re-runs the node: an Agent step is
     reopened with its harness session id, on its Device. The placed
     Device, when its link takes work again, names the calls it still
     serves; the Host cancels the ones it does not know, so the old session
     stops there; a reply for an unknown call stops it too. So the Walker
     does not ask the placed Device before re-running; the old session is
     stopped when the Device is back, and the resumed one continues the
     harness session. A Command step runs again from its start.
   - **A `bun --hot` reload of the placed Device** is not a restart: the
     devices runtime (`startDevices`) hands the calls it serves to the
     next one (`ServedCalls`), which names them to the Host again. The
     session runs on, once, and its replies go over the new link.
   - **Usage limits per Device.** `WaitStarted.deviceId` names the Device
     of a policy wait: a usage limit is that Device's harness login's (the
     open item). Steps of other runs on that Device still try once
     themselves (no wait shared across runs: it changed the run policy's
     tested behaviour).
   - **Move to…** (`runs.move`, `run.move` permission; the run page's "Move
     to…", for a run that waits, sleeps or has stopped, not mid-step). The
     Walker archives the run's latest checkpoint and its steps' transcripts
     and logs where the Space is kept (itself, or its Host: `archive.put`),
     appends `WalkerMoved` (from, to, by) as its last event and forgets the
     run. Every Replica moves the run row's Walker with that event
     (`applyWalkerMoves`; a run from before Placement keeps its old Walker
     as its Device), and the exchange takes a moved run's rows from each of
     its Walkers. The new Walker takes it over when the event arrives:
     the checkpoint from the archive into its own tables
     (`importWalk` of the engine's walk state), and a sleeping run's timer; a run at a Gate
     waits there, a stopped one for a resume. It ends the take-over with
     `WalkerArrived` (from), its first event of the run. Until the new
     Walker wrote to the run, it still arrives (`runsArriving`): recovery
     leaves it alone, a take-over that fails (the Host away, the archive
     without the checkpoint yet) is tried again with a growing wait, and
     one a restart cut short is done when the next engine is ready. Recovery takes the runs whose row names this computer, with
     their whole log, so a run that arrived gets its timer back after a
     restart. A run walked elsewhere moves by a `run.move` command to its
     Walker. A moved step's transcript is read from the archive.
   - **Schedules**: `device` in `schedules.json` names the Device that
     fires the schedule; without one, the Replica that keeps the Space
     fires it (its Host, or the one Device of a Space without one), so a
     schedule every Clone reads fires once. A Host without a Clone cannot
     read the file: name a Device then. A schedule's run with placed nodes
     uses this computer's owner's Devices.
   - **The resume grace** now counts from when the engine is ready (it
     started at recovery, before the engine's start ended: the flaky
     "an open run continues on its own" test).
   - Tests: `packages/devices/src/placement/placement.test.ts` (per-node with
     the Hand-off there and back, a dirty worktree fails the step, offline
     then back, an unknown name, the profile's Device); `apps/server/test/
     devices/handoff.test.ts` (two daemons with one bare remote: A walks a
     run whose middle node runs on B, a dirty worktree, B walks a run with
     a node on A through A, a node whose Device is offline sleeps and
     continues when B is back, Move to: B takes over a run waiting at its
     Gate, answers it, and its last step runs on A); `work.test.ts` (the
     hub's cancels after a restart).
   - Not yet: Offers (another Person's Device), a Device that walks a run
     whose run Device is another (the Host walks those), a `${NAME}` the
     placed Device lacks refusing at start, "Move to…" of a run mid-step.
     A Device's name is its host name until a rename exists: two Devices
     of one name cannot be told apart by a node (run start refuses it).
6. **Sharing.** Invitation-only signup, Members and roles, Offers with the
   Device-side checks, audit events, per-Person git identity in worktrees.

   *Landed (part A, Members):*
   - **Invitation-only.** Better Auth's admin plugin: `user.role` is the
     Person's role on the Host, `admin` for the Host admin, else `user`
     (not a role in a Space). The first Person is the Host admin: the
     user-create hook gives `admin` while the Host has none, and the
     migration names this computer's Person (else the earliest account).
     `localPerson`, which makes a Person without the hooks, claims it the
     same way. Email and password sign-up (`/sign-up/email`) is refused by
     a `hooks.before` unless the Host has nobody yet, or the body names a
     pending, unexpired invitation of that email (`invitationId`): so the
     link, not only the email, makes the account
     (`packages/auth/src/spaces/members.ts`). The admin's own `createUser` stays
     open to the Host admin. One person on one computer is untouched: the
     local Person and the local session make no sign-up.
   - **No email server.** Invitations are stored only (no
     `sendInvitationEmail`); the Members page shows the link to copy:
     `<the page's origin>/invite/<invitation id>`. The id is the link's
     secret. Invitations last seven days (`INVITATION_DAYS`), since a
     person passes the link on by hand. An email sender is the plugin's
     `sendInvitationEmail` hook, later. The link uses the origin of the
     browser that made it: open the Members page by the Host's `https://`
     address to get a link a colleague can use.
   - **Accepting** (`/invite/$invitationId`, outside the app's sidebar,
     like `/login`): `invitations.get` is public (Space, inviter, role,
     status, whether the email has an account here). No account: name and
     password make one (the email is the invitation's), then
     `invitations.accept`; an account: sign in, then accept; already
     signed in with that email: Join. Accepting makes the Person a Member
     and the session's active Space (the plugin does both), and the app
     goes home in it. `/login` signs in only: "New here? Open the
     invitation link."
   - **Members page** (`/members`, sidebar under Inbox): `members.list`
     (Members with name, email, role; pending invitations; what the
     session may change), `members.invite` (admin, member or viewer),
     `members.cancelInvitation`, `members.setRole`, `members.remove`, each
     behind its `member.invite`, `member.role` or `member.remove` check
     (`permitted`), then the organization plugin checks the role again
     (an admin cannot touch an owner; nobody deletes a Space without
     `space.delete`). Personal Space: "Nobody can join it" and Create
     Space. Custom roles are not in this slice.
   - **Audit.** The organization hooks report `MemberChange` (joined,
     removed, role) with the Person whose session called the endpoint
     (Better Auth's endpoint context, `tryGetCurrentAuthEndpointContext`).
     The daemon logs `MemberJoined` (`personId`, `role`, `by`,
     `invitedBy`), `MemberRoleChanged` (`previousRole`) and
     `MemberRemoved` in that Space (`engine.logMemberChange`). Making a
     Space logs its owner's `MemberJoined`. The Space document's member
     mirror follows as before.
   - **Who started a run.** `RunStarted` gains `startedBy` (appended), and
     `run.started_by` (no foreign key, like `walker_id`). `runs.start`
     passes the session's Person; a schedule's run has none. The migration
     names this computer's Person for every run no schedule started. A
     run's summary has `startedBy` (id and name, from the Replica's
     accounts); the run page's "Started by" says You, their name, or the
     schedule. Run bundles are format 4 (`started_by`); format 3 reads
     with none.
   - **Git identity per Person.** The worktree's own config gets the
     starter's `user.name` and `user.email` (`RunRef.author`,
     `setWorktreeAuthor`): `git config --worktree`, which needs
     `extensions.worktreeConfig` in the clone, set once (as `git
     sparse-checkout` does). The clone and its other worktrees keep their
     identity. A Person with no real email (`…@nightshift.invalid`, this
     computer's own) gets none: the repository's identity stays.
   - Tests: sign-up refused without an invitation, for another email and
     for a canceled one; the first Person is the Host admin; invite, sign
     up, accept, member in the Space; a viewer cannot invite; an admin
     cannot delete the Space; a removed member loses the Space (and its
     document on the relay); role changes and removals name who made
     them; `startedBy` and the worktree identity, and none for the local
     Person.
   - Not yet (part B, after placement): Offers and the offering Device's
     own checks; the git identity on a Device that runs a colleague's
     step comes with them.

   *Landed (part B, Offers):*
   - **An Offer is two entries** (`packages/devices/src/offers/offers.ts`): the
     Device's own, in its Device document's `offers` (`DeviceOffer`: Space,
     profile, `permissionCap`, `sessionCap`, when), the caps the Device
     enforces; and the publication in the Space document's `offers`
     (`SpaceOffer`: Device id and name, profile name, the caps, when, by
     whom; never the profile's settings, tools or secrets). An Offer is in
     force when both hold it (`inForce`). Making publishes first, then
     keeps the own entry; withdrawing removes the own entry first (the
     Device refuses new work at once), then the publication.
   - **Who makes one.** The Device's owner, on that Device's Agents page
     ("Offer to a Space…" on a profile), into a shared Space where their
     role allows the new `offer.make` (owner, admin; a member has
     `offer.use` only). Not into a personal Space. The publication is
     written by the Replica that keeps the Space: `engine.offers.publish`
     here, or through the Host (`sync.offer`, `sync.withdrawOffer`, which
     check the key's Person's role there and name them in the event).
     `OfferMade` (Device id and name, profile, caps, `by`) and
     `OfferWithdrawn` (Device id, profile, `by`) go in the Space's log.
   - **Profiles stay on their Device.** A run of another Person through an
     Offer is not resolved at start: the run's copy keeps the node's
     `profile` and no settings, and the Agent node asks the Device for an
     offered session (`OfferedSessionInput`: the profile's name and the
     node's own permission mode, if any). The Device resolves its own
     profile (`offeredSession`) and says which harness runs it in `ready`
     (`harness`, appended), so the Walker records the session.
   - **The Walker's check at run start** (`PlacementPort.plan`, then
     `place` and `offerRefusal`):
     a run's Device of another Person needs Offers into the Space
     (refused at once: "hetzner-1 is not your device. It offers nothing
     to this Space."), and the starter's role must allow `offer.use`
     (`EngineOptions.mayUseOffers`, from the Space document's Member
     mirror). Every node that touches that Device must be an Agent node
     that names an offered profile ("hetzner-1 offers "coder" to this
     Space, not "claude"."), sets none of what the profile sets (harness,
     model, effort, CLI tools, connections, MCP servers, checker), and
     asks for no wider permission mode than the cap. A node that touches
     nothing there (a Gate, a rule, a wait for a time or a signal, a Call)
     needs no Offer; a command, a tool, a model decision or value, a wait
     on a command and a list from a command are refused. The same rule
     holds for this computer: another Person's run walked here uses it
     through its own Offers (`OfferAdmission.deviceFor`, then
     `offeredDevice`). Before, any Member could
     run anything on the Host.
   - **The Device's own checks** (`OfferAdmission.serve` in
     `packages/devices/src/offers/admission.ts`; then `checkWork`, a second
     code path, which the one admission replaced): for a run its
     owner did not start, the requester is a Member (the Space
     document's Member mirror) whose role allows `offer.use`; it has
     Offers in force into that Space; the call is an offered session of
     one of them, or the run's own folder work (flows, worktree, files,
     item branches). A command, a tool, the decider, an own session and
     its capabilities (private to its owner) are refused. The Clone and
     run-folder checks of part A hold for both.
   - **Caps.** The permission mode: the Walker refuses a node that asks
     for more; the Device clamps whatever it gets to the cap (the
     profile's own mode too). The session cap: a session over it **waits**
     on the Device for a free one, first come first served
     (`createOfferSlots`), and is not refused, so a colleague's runs slow
     down instead of failing. Waiting ends with the call's abort.
   - **Withdrawing** stops running steps as stopped: the Walker tracks the
     offered sessions it carries (per run, Device, Space and profile) and
     `engine.offers.withdraw` stops those runs; the Device then aborts
     what still runs under it (`OfferAdmission.withdrawn`, then
     `WorkServer.withdrawn`), also when its Host
     cannot be reached.
   - **Git identity** on a Device that runs a colleague's step: the run's
     `worktree` call carries the starter as `RunRef.author`, as in part A.
     Tested with the colleague's email in the worktree on B.
   - **Visibility.** `devices.space` (any Member): the Space's Devices
     with their name, online state (null where this computer cannot
     tell), the Space's Projects they have a Clone of, and their offered
     profiles with caps. Nothing else of a Device. Placements list other
     Persons' Devices with `offers` (their profile names); Start run shows
     them under "Offered to this Space".
   - **UI.** The Agents page: "Offer to a Space…" on a profile (Space,
     permission mode at most, sessions at once; the dialog says the agent
     runs with your login and your tools: "A `gh pr create` in a flow a
     colleague wrote uses your `gh`."), the Spaces it is offered to, and
     Withdraw. The Devices page: "Offered to Spaces" (each Offer with
     "Runs for <Space>": the runs of other people here, and Withdraw) and
     "Devices in this Space".
   - Tests: `packages/devices/src/offers/offers.test.ts` (the run-start rule, the
     clamp, the queue, another Person's run on the computer that walks it,
     withdrawing stops it, the Space document's entry has only the public
     fields); `packages/devices/src/offers/admission.test.ts` (the admission
     called directly, as a bypassed Host would: no Offer, an Offer on one side
     only, another profile, a command, a non-member, a viewer; the work
     server's clamp, queue and abort); `apps/server/test/devices/offers.test.ts`
     (two daemons, two Persons: refused without an Offer, the offer
     listed with nothing else of B, another profile and a wider mode
     refused at start, a run through the Offer on B under the caps in the
     colleague's name, a second session waits, withdrawing stops a running
     step and logs `OfferWithdrawn`).
   - **With per-node Placement** (merged with slice 5 part B). Every
     placed Device is checked on its own: a Device of another Person (by
     the run's `deviceId`, or by the name a node gives it, also from the
     Space's Offers when none of your Devices has that name) is a
     `PlacedDevice` with `offered`, and run start applies `offerRefusal` to
     the nodes placed there, and the requirements to the others. Its
     nodes keep their profile unresolved; the "profile's Device" fallback
     to this computer is skipped when the run's Device or this computer is
     offered. The Device checks again per call (`OfferAdmission.serve`),
     on a Device and on the Host for itself (then `checkWork` and
     `serveChecked`). A Device that
     walks a run reaches another Person's Device through the Host
     (`devices.call`): the Host relays it when that Device offers to the
     run's Space, and `devices.reachable` answers for it. The Hand-off
     (`handOff`, `receiveHandOff`) is the run's own folder work, allowed
     under an Offer. "Move to…" lists your own Devices only: an Offer runs
     steps, it does not walk runs. Runs the Walker carries to an offered
     Device are tracked for a withdrawal on that Walker; one withdrawn on
     another Walker's Device is aborted there (the step fails).
   - **Schedules.** A schedule whose `device` is another Person's Device
     runs the saver's runs there: saving it (Schedules) stamps the saver
     as its `person` (as the Space knows them) and is refused unless that
     Device's Offers cover what the flow runs there ("The schedule
     "nightly" fires on another person's device. hetzner-1 is not your
     device. It offers nothing to this Space."). When it fires, the run is
     that Person's (`startedBy`), so run start checks the Offers again: a
     withdrawn Offer refuses the start, and `ScheduleFired` records the
     reason. A schedule on your own Device names no Person.
   - **Paths stay with the Device's owner.** `runs.list`, `runs.get` and
     the start's answer show a run's `worktreePath` (and the take-over
     command that names it) only to the owner of the run's Device;
     everyone else gets `""` and no command. A Device whose owner this
     Replica cannot tell shows none.
   - **The flow editor's Device field** lists your Devices and, for an
     Agent node, the Devices of other people that offer its profile to
     the Space ("hetzner-1 (offers coder)"); `runs.devices` carries
     `offers` for them.
   - Not yet, and risky: a schedule file is the repository's, so a
     schedule written by hand (without the Schedules page) has no
     `person`, and its runs are the firing Device's owner's, as in slice
     5 part B: anyone who can push the file can name a Device. Withdrawing
     an Offer of another of your Devices from the Host's page is not
     built: withdraw it on that Device. A Device rename and a `${NAME}`
     the placed Device lacks refusing at start are not built.
7. **From anywhere.** TLS or tailnet guidance, the Linux binary, the
   desktop app as a Host or joining one.

   *Landed (from anywhere):*
   - **`nightshift`, one file** (`apps/server/scripts/build-binary.ts`,
     `bun run --cwd apps/server build:binary --target all`): `bun build
     --compile` for linux-x64, linux-arm64 and darwin-arm64. A generated
     entry embeds the web build and every `migration.sql` (imports `with {
     type: "file" }`) and hands them to the CLI (`src/headless/embedded.ts`).
     Two build plugins: varlock's loader becomes `process.env` (the shims
     the desktop app used, moved to `apps/server/scripts/shims`), and libsql's
     run-time pick of `@libsql/<target>` becomes a fixed `require` of the
     target's `index.node`, which the executable then embeds. Another
     platform's native package is downloaded from npm once, checked against
     the registry's integrity, and kept in `apps/server/.cache/`. No
     sourcemap file; identifiers stay unminified so a stack trace reads.
     Tested: the darwin binary on this Mac with a fresh data folder; both
     Linux binaries in a Debian container (x64 under emulation).
   - **The CLI** (`apps/server/src/features/cli/cli.ts`): `nightshift serve` (flags
     over the environment: `--port`, `--data-dir`, `--host-address`
     repeated, `--listen`, `--tls-port`, `--web`), `nightshift join
     <host> [--guest]`, and new `nightshift pair <code> [--yes]`, which
     approves a code on a Host without a screen (it calls the local
     daemon's `devices.review` and `approve` as this computer's Person;
     `docker exec` works). `serve` fills the environment the way the
     desktop app did (`packages/daemon/src/runtime/daemon-env.ts`, now shared):
     `BETTER_AUTH_URL` and `CORS_ORIGIN` default to the first `https://`
     Host address (the UI is served by the daemon itself), else
     `http://localhost:<port>`. It extracts the migrations to
     `<data dir>/migrations` before the server loads
     (`migrateDb(db, { migrationsFolder })`).
   - **The daemon serves its UI** when it has one (embedded, or
     `NIGHTSHIFT_WEB_DIR`, `src/headless/web.ts`): GET only, never `/rpc`,
     `/api`, `/sync`; `/` only for `Accept: text/html` (a probe still gets
     "OK"); a prerendered page by path, else `index.html`, which routes in
     the browser (React reports a recoverable hydration mismatch there).
     Each page gets `<meta name="nightshift-daemon">`, and the UI then
     calls the origin it came from instead of `VITE_SERVER_URL`
     (`apps/web/src/shared/api/server-url.ts`): a Host has several addresses, and
     the one the browser used is the one that answers.
   - **Secrets without a keychain.** The auth secret: `BETTER_AUTH_SECRET`,
     else the file `BETTER_AUTH_SECRET_FILE`, else `BETTER_AUTH_SECRET` in
     the secrets folder, else made once in the data folder (0600). A
     `${NAME}`: the environment, then a file `NAME` in the secrets folder
     (`NIGHTSHIFT_SECRETS_DIR`, else systemd's `CREDENTIALS_DIRECTORY`),
     read at start, under the environment. Secrets saved on the
     Connections page go to the keychain where it works, else
     `<data dir>/secrets/<NAME>` (0600), the same choice as Device keys
     (`packages/engine/src/device-config/keychain.ts`, `NIGHTSHIFT_KEY_STORE=file`). The
     Devices page says where: "Secrets and access to your Hosts".
   - **Listening.** `NIGHTSHIFT_LISTEN` narrows where a Host binds (default
     `0.0.0.0`): `127.0.0.1` when its way out runs on the same computer. A
     daemon that is not a Host binds `127.0.0.1` whatever it says. With its
     own certificate, `nightshift serve` and the desktop app keep plain
     http on `127.0.0.1:PORT` for this computer (the window, the CLI) and
     serve https on `NIGHTSHIFT_TLS_PORT` (default `PORT + 443`) at the
     Host's hostname (`packages/daemon/src/http/serve.ts`). `bun run dev` keeps
     slice 4's single listener.
   - **A proxy is not this computer.** Every way out connects to the
     daemon from the loopback. The local session now also needs no
     forwarding header (`Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`,
     `X-Real-IP`, `CF-Connecting-IP`, `Tailscale-User-Login`) and a
     loopback name in the URL (a TCP tunnel such as rathole passes the
     public name on). The daemon's own `http://localhost:PORT` and
     `http://127.0.0.1:PORT` are trusted origins, for its UI over an SSH
     tunnel.
   - **The desktop app** starts the daemon with `serveDaemon`, so it binds
     by the Host rules and serves its certificate (it passed no `tls`
     before), flushes the Space documents on quit, and its Devices page
     has **Join a Host** (`join-host-dialog.tsx`: address, home or guest,
     the code and fingerprint, waits, closes when the Host allows it; the
     same `devices.join` stream). A streaming procedure's error now
     reaches the UI as its message (`readable`, `packages/api`); before,
     "declined" or "expired" read "Internal server error". A certificate
     this computer can neither trust nor pin (a proxy's private authority)
     says so when joining.
   - **Link order** was already right in part A: the Device saves the
     Host's list from the pairing answer, learns it again from every
     `hello` and heartbeat (the Host's order, then its own others), and
     tries them in order. Tested with the binary: a Host with
     `https://studio-lan.invalid:3932, https://localhost:3932`, joined at
     the second, keeps both and is online at the second.
   - **Deploy** (`deploy/`): a two-stage Dockerfile (Node for the Vite
     build, whose prerender does not run on Bun alone; `oven/bun:1.3.10-slim`
     with git and ssh to run), `docker-compose.yml` with Caddy, and a systemd
     unit with `LoadCredential=`. Guides in `docs/deploy/`: LAN with a
     self-signed certificate (`.local` by mDNS, first address), tailnet
     (Serve, Funnel and its caveats), public server (Compose with Caddy,
     Dokploy, plain Caddy), outbound tunnel (Cloudflare Tunnel, frp,
     rathole). Tested end to end: the image behind Caddy, a computer
     joining it as a guest, `docker exec … nightshift pair`. Tailscale,
     Let's Encrypt, Cloudflare Tunnel, frp and rathole are written from
     their docs.
   - **The Host admin's sign-in on a Host without a screen.** The Host
     admin is this computer's Person (slice 6), which signs in for nothing
     on the Host and has no password. `nightshift admin --email <email>`
     (on the Host, or `docker exec`) gives it an email and a password,
     asked without echo or piped with `--password-stdin`
     (`account.setLogin`: the owner only, and only from this computer:
     `Context.fromThisComputer`; `packages/auth/src/login/login.ts` links a
     credential account or replaces its password). `nightshift serve`
     reminds you while a Host's admin has none. Then the admin signs in at
     the public address and invites from Members; the invitation link uses
     the page's origin, so the public one. Better Auth trusts every Host
     address as an origin (`AuthOptions.trustedOrigins`, read per request),
     so sign-in works at each of them. Tested through Caddy with the
     Docker image.
   - Not yet: the desktop app does not serve its UI to other computers'
     browsers. A container sees an SSH-tunnelled request as another
     computer's.

Slices 1 to 3 are refactors in the shape of the eight that landed on
2026-10-19. Slice 4 is the first that needs a second computer.

## Decisions

Taken on 2026-10-19:

1. **Sync layers**: Yjs + Hocuspocus for the documents, event log exchange
   over oRPC for run history.
2. **Spaces as Better Auth organizations**, a personal Space per Person,
   home and guest Hosts per Device.
3. **A dirty tree at a Hand-off fails the step** with a clear reason. No
   automatic commit.
4. **Default Walker**: the Space's Host.
5. **Offers are per (Device, profile, Space) with caps.**
6. **Connectivity**: a Host advertises several `https://` addresses and a
   Device falls through them (LAN, tailnet, public); the Host's way out is
   one of three documented deployments, none shipped; the transport is a
   `Link` port with `httpsLink` now and iroh as the later peer-to-peer
   adapter (see "Connectivity").

Nothing is open. The next step is slice 1.

## Open items

- ~~Verify Hocuspocus 4 and `ws` under Bun 1.3 in the daemon process.~~
  Done in slice 3: Hocuspocus 4.7 runs in the daemon on Bun 1.3.10, with
  no `ws`. Hocuspocus 4 takes any WebSocket-like object and a standard
  `Request` (`handleConnection(socket, request, context)`), so Bun's own
  `server.upgrade` and `websocket` handlers feed it (`open`, `message`,
  `close`, and `pong` → `touch()`). Its bundled `Server` class uses
  `node:http` with crossws, and is not needed. One trap: Bun empties a
  request's headers once it upgrades it, so the sync keeps a copy for
  `onAuthenticate`. `HocuspocusProvider` syncs under Bun with its global
  `WebSocket` (`packages/daemon/src/sync/sync.test.ts`). The SQLite extension
  needs `better-sqlite3`, which Bun does not load: the Replica's own
  `ydoc` table is used instead.
- ~~Better Auth version: the device authorization plugin needs 1.6.11+.~~
  1.7.7, with a test that one Person cannot approve another's code.
- A headless Device has no keychain: secrets from its environment or a
  file its service manager provides. Say which on the Devices page.
  Done for Device keys in slice 4 and for secrets in slice 7 (files in
  the data folder, a secrets folder, systemd credentials).
- A `${NAME}` the placed Device lacks should refuse at run start.
- ~~The usage-limit sleep is per harness login, so per Device. The sleep
  module needs the Device in its key.~~ Done in slice 5, part B
  (`WaitStarted.deviceId`).
- ~~Transcripts of a Run walked elsewhere are fetched from the archive on
  open.~~ Done in slice 4, part B. Archive retention is undecided, as run
  retention is today: everything is kept.
- ~~A running step of a Run walked elsewhere shows its transcript only
  once it ended.~~ Done: "Live transcripts", followed on demand.
- Direct Device-to-Device sync on one LAN without the Host: later.
- Identity across Hosts: a colleague has an account per Host until the
  OIDC provider plugin makes the home Host the login for guest Hosts.
- End-to-end encryption of Device documents: later; the home-Host rule
  covers the colleague case without it.
- ~~VISION lists "shared runners" and "server mode" as out of scope.~~
  Updated with slice 4.

## Sources

- Better Auth: [organization plugin](https://better-auth.com/docs/plugins/organization), [device authorization plugin](https://better-auth.com/docs/plugins/device-authorization), [API key plugin](https://better-auth.com/docs/plugins/api-key), [CVE-2026-45337](https://app.opencve.io/cve/CVE-2026-45337)
- Turso Sync: [Introducing Databases Anywhere](https://turso.tech/blog/introducing-databases-anywhere-with-turso-sync), [usage](https://docs.turso.tech/sync/usage), [replay bug #9330](https://github.com/tursodatabase/turso/issues/9330)
- Hocuspocus: [4 is now stable](https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release), [SQLite extension](https://tiptap.dev/docs/hocuspocus/server/extensions/sqlite), [hooks](https://tiptap.dev/docs/hocuspocus/server/hooks), [authentication](https://tiptap.dev/docs/hocuspocus/guides/authentication)
- Yjs growth: [document growing unbounded](https://discuss.yjs.dev/t/document-growing-unbounded/3729), [memory requirements](https://discuss.yjs.dev/t/understanding-memory-requirements-for-production-usage/198)
- LiveStore: [how it works](https://docs.livestore.dev/evaluation/how-livestore-works/), [changelog](https://dev.docs.livestore.dev/changelog/). cr-sqlite: [Fly's fork](https://github.com/superfly/cr-sqlite)
