/**
 * The capability map: every vertical of every checked workspace, and what
 * it is. `scripts/check-capabilities.ts` reads it.
 *
 * A vertical is one of three kinds.
 *
 * - A **capability** is a product area. It holds rules or data of one thing
 *   a person meets in Night Shift: what they may do there, and what it
 *   means. Its name is a word of `docs/glossary.md`, in the folder form the
 *   repository uses (`runs`, `gates`, `flows`). One capability has the same
 *   folder name in every workspace that holds a part of it.
 * - A **mechanism** is shared machinery. It carries, stores, formats or
 *   connects for the capabilities, and it decides nothing about a product
 *   area. Its name is its folder name. A word of the glossary does not make
 *   a vertical a capability: the run log, the Space archive and a Lease are
 *   machinery that the capabilities use.
 * - The **wiring** is the piece of a workspace that composes its
 *   capabilities. A workspace has at most one, and it is the `shared/shell`
 *   of an app: the frame of the app, which puts the features on the screen
 *   together. It may import every capability, so V2 and V5 do not apply to
 *   it. No vertical imports it: only the routes, the entry folders and the
 *   entry files do. Rule (h) of `scripts/check-verticals.ts` checks that.
 *
 * The rules (the check has the details):
 *
 * - V1a Every vertical on disk is in VERTICALS, and every entry is on disk.
 * - V1b A capability vertical has the folder name of its capability. A
 *   vertical that is part of a capability under another name is on the
 *   rename debt list (`scripts/capability-debt.txt`). Two verticals of one
 *   workspace with one capability become one vertical with sub-verticals.
 * - V2 A mechanism imports no capability of its workspace. The wiring may.
 * - V5 A capability imports at most 5 other capability verticals of its
 *   workspace.
 *
 * How to place a vertical:
 *
 * 1. It holds the rules or the data of a product area: give it that
 *    capability, also when its folder has another name (engine `run`,
 *    `read` and `run-status` are `runs`).
 * 2. It only serves other verticals and has no product rule of its own:
 *    MECHANISM. Say why in a comment when the name does not.
 * 3. An app's `shared/<name>` piece is a mechanism. The one exception is
 *    rule 4.
 * 4. An app's `shared/shell` that composes its features is WIRING. A shell
 *    that imports no feature is a mechanism (the Insights admin: its route
 *    passes in what the frame shows). An app that composes in its entry
 *    files has no wiring piece (`apps/desktop`, `apps/server`).
 * 5. A vertical of a package that composes the others (`devices/peers`) is
 *    a mechanism. Its imports of capabilities are V2 debt until the wiring
 *    moves to a `wire.ts` outside the verticals.
 *
 * A vertical is named as `scripts/check-verticals.ts` names it: its path in
 * `src/` (`graph`, `features/runs`, `shared/api`).
 */

/**
 * The capabilities of the product. `word` is the term of `docs/glossary.md`
 * that names it. The check fails a word the glossary does not have.
 */
export const CAPABILITIES = {
	access: {
		word: "Member",
		meaning:
			"Who a Person is and what they may do: sign-in, two-factor sign-in, roles, who may use a Host.",
	},
	agents: {
		word: "Agent Profile",
		meaning:
			"The agents of a computer: harnesses, deciders, profiles and their setup.",
	},
	assistant: {
		word: "Built-in agent",
		meaning:
			"Night Shift's own agents: a suggestion for a field, the chat about a flow, what an answer cost.",
	},
	dashboard: {
		word: "Dashboard",
		meaning: "The numbers of a Space or a Project, computed from its Runs.",
	},
	devices: {
		word: "Device",
		meaning:
			"The computers that run Night Shift: this computer, pairing, Hosts and Offers.",
	},
	flows: {
		word: "Flow",
		meaning:
			"The flows of a Project: keep, edit, save, import and export them.",
	},
	gates: {
		word: "Gate",
		meaning:
			"The questions that wait for a person: the Needs-you inbox and the answer.",
	},
	knowledge: {
		word: "Knowledge",
		meaning:
			"What a Project knows: its sources, its learnings, the search, and what an agent reads of it.",
	},
	notifications: {
		word: "Notification settings",
		meaning: "Whom Night Shift tells, about what, and on which screen.",
	},
	projects: {
		word: "Project",
		meaning: "Projects, their folders and their Clones.",
	},
	runs: {
		word: "Run",
		meaning:
			"A Run from start to end: start it, place it, read it, act on it, and clean up what it left.",
	},
	schedules: {
		word: "Schedule",
		meaning: "When a flow runs on its own: at set times or on a webhook.",
	},
	secrets: {
		word: "Secret",
		meaning: "The values a flow reads by name, and the scope of each.",
	},
	settings: {
		word: "Setting",
		meaning:
			"The configuration of one computer: settings, connections, CLI tools and profiles in its Device document.",
	},
	spaces: {
		word: "Space",
		meaning: "Spaces, their Members and their invitations.",
	},
	spend: {
		word: "Spend",
		meaning: "What the flows cost, and where a change saves money.",
	},
	widgets: {
		word: "Widget",
		meaning:
			"What a Phone shows outside the app: the home screen widget and a followed run on the lock screen.",
	},
} as const satisfies Record<string, { word: string; meaning: string }>;

/**
 * The capabilities of the Insights admin (`apps/insights`,
 * `packages/insights`). It is a bounded context of its own, for the people
 * who make Night Shift, and the glossary does not name its areas. So these
 * have no glossary word.
 */
export const INSIGHTS_CAPABILITIES = {
	days: "Runs per day, how runs end, and the guards that stopped them.",
	feedback: "What people answer about their runs.",
	funnel: "The steps an install takes, and where installs stop.",
	ingest: "The rules that take a usage event in, or refuse it.",
	ladders: "Where the work lands on the ladders.",
	mix: "The agents, systems and versions of the installs.",
	overview: "The numbers at a glance, and the installs to look at.",
	proof: "The numbers that show Night Shift does its work.",
	reports: "The usage numbers, as the admin pages ask for them.",
	retention: "The installs that come back.",
} as const satisfies Record<string, string>;

export type Capability =
	| keyof typeof CAPABILITIES
	| keyof typeof INSIGHTS_CAPABILITIES;

/** A vertical that is shared machinery. Its name is its folder name. */
export const MECHANISM = "mechanism";

/**
 * The piece of a workspace that composes its capabilities: an app's
 * `shared/shell`. V2 and V5 do not apply to it.
 */
export const WIRING = "wiring";

export type Place = Capability | typeof MECHANISM | typeof WIRING;

const M = MECHANISM;

/**
 * Each workspace, and each of its verticals with its capability,
 * MECHANISM or WIRING. Sorted by workspace, then by vertical.
 */
export const VERTICALS: Record<string, Record<string, Place>> = {
	"apps/desktop": {
		// The desktop app is the shell around the daemon. Only its
		// notifications are a product area. The rest starts, guards, updates
		// and decorates the app.
		"features/daemon": M,
		"features/external": M,
		"features/moon": M,
		"features/notifications": "notifications",
		"features/updates": M,
		"features/watchdog": M,
	},
	"apps/insights": {
		"features/access": "access",
		"features/days": "days",
		"features/feedback": "feedback",
		"features/funnel": "funnel",
		"features/ingest": "ingest",
		"features/ladders": "ladders",
		"features/mix": "mix",
		"features/overview": "overview",
		"features/proof": "proof",
		"features/reports": "reports",
		"features/retention": "retention",
		// The admin's own sign-in (Better Auth, its tables, the one admin).
		"features/session": "access",
		"shared/api": M,
		"shared/config": M,
		"shared/format": M,
		"shared/page": M,
		"shared/rpc": M,
		// The frame of the admin. It imports no feature: the route passes in
		// what it shows. So it is a mechanism, and V2 holds for it.
		"shared/shell": M,
	},
	"apps/mobile": {
		"features/devices": "devices",
		// The home screen widget and the followed run on the lock screen.
		"features/glance": "widgets",
		// This phone's sign-in on its Host, and the session.
		"features/host": "access",
		// The open Gates, and one Gate in full.
		"features/inbox": "gates",
		// The Needs you queue and the bar that sends an answer.
		"features/needs": "gates",
		// This phone's notifications.
		"features/push": "notifications",
		"features/runs": "runs",
		// The Runs tab: the runs on their way and tonight's schedules.
		"features/runs-tab": "runs",
		"features/schedules": "schedules",
		"features/settings": "settings",
		"features/spaces": "spaces",
		"shared/api": M,
		"shared/avatar": M,
		"shared/clock": M,
		"shared/empty": M,
		"shared/feedback": M,
		"shared/format": M,
		"shared/header": M,
		"shared/in-front": M,
		"shared/list": M,
		"shared/markdown": M,
		"shared/native-list": M,
		"shared/page": M,
		"shared/refresh": M,
		// The shell composes the features (rule 4).
		"shared/shell": WIRING,
		"shared/status": M,
		"shared/theme": M,
		"shared/tone": M,
		"shared/trail": M,
	},
	"apps/server": {
		// The `nightshift` command line: a surface that calls the daemon, like
		// the API. It holds no rule of a product area.
		"features/cli": M,
	},
	"apps/web": {
		"features/access": "access",
		"features/agents": "agents",
		"features/dashboard": "dashboard",
		"features/devices": "devices",
		"features/flows": "flows",
		"features/gates": "gates",
		"features/knowledge": "knowledge",
		"features/notifications": "notifications",
		"features/projects": "projects",
		"features/runs": "runs",
		"features/settings": "settings",
		"features/spaces": "spaces",
		"features/spend": "spend",
		"shared/agent-button": M,
		"shared/api": M,
		"shared/code": M,
		"shared/data-table": M,
		"shared/detail": M,
		"shared/format": M,
		"shared/larger-window": M,
		"shared/markdown": M,
		"shared/media-query": M,
		"shared/moon": M,
		"shared/page": M,
		"shared/panel": M,
		// The shell composes the features (rule 4).
		"shared/shell": WIRING,
		"shared/spread-strip": M,
		"shared/time": M,
		"shared/urgency": M,
		"shared/usage": M,
	},
	"packages/agents": {
		assistant: "assistant",
		// The decider providers and their list: the models of a Model Profile.
		decider: "agents",
		// Is a program on this computer, which version, whose login.
		doctor: M,
		// One adapter and one record of facts per harness.
		harnesses: "agents",
		knowledge: "knowledge",
		// The contract between the engine and a harness or a decider.
		port: M,
		// What a session or a model call cost, from a price list.
		pricing: M,
		// One harness session behind every adapter: the sandbox, the stream,
		// the tool bridge. It runs a session and decides nothing about agents.
		session: M,
		// The skill files a harness can run.
		skills: M,
		// The MCP client and the help of a CLI program. The definitions of
		// the tools are `settings` (the Device document of the engine).
		tools: M,
	},
	"packages/api": {
		assistant: "assistant",
		// This computer's configuration: settings, harnesses, profiles,
		// connections, CLI tools and the guided setup.
		config: "settings",
		dashboard: "dashboard",
		devices: "devices",
		flows: "flows",
		gates: "gates",
		knowledge: "knowledge",
		notifications: "notifications",
		projects: "projects",
		runs: "runs",
		schedules: "schedules",
		spaces: "spaces",
		// Anonymous usage is not a word of the glossary. It is the export
		// that `telemetry` owns.
		usage: M,
	},
	"packages/auth": {
		access: "access",
		// What a paired Device signs in with on a Host.
		"device-keys": "devices",
		// Who may use this Host: one decision for every way in.
		"host-access": "access",
		// The session of this computer's own Person.
		"local-session": "access",
		// A Person's email and password.
		login: "access",
		// The device authorization that pairs a Device with a Host.
		pairing: "devices",
		spaces: "spaces",
		"two-factor": "access",
	},
	"packages/client": {
		// The typed client, its query client and how a call is refused.
		api: M,
		// What a write makes stale: one table for both apps.
		changes: M,
		dashboard: "dashboard",
		devices: "devices",
		flows: "flows",
		gates: "gates",
		// What a widget and a lock-screen run show.
		glance: "widgets",
		knowledge: "knowledge",
		// The live cache: the one follower of a Host for both apps.
		live: M,
		notifications: "notifications",
		projects: "projects",
		runs: "runs",
		schedules: "schedules",
		spaces: "spaces",
		usage: M,
	},
	"packages/daemon": {
		assistant: "assistant",
		// The harness table of this computer.
		harnesses: "agents",
		// The Hono app and its routes.
		http: M,
		// The OS's sleep lock behind a port. The rule for when to hold it is
		// the engine's.
		"keep-awake": M,
		notifications: "notifications",
		// The boot: the env, the database, the lease, health, the hot slots.
		runtime: M,
		// The transport of the synced documents.
		sync: M,
		// The export's headers, moved from their old store, and the counts of
		// the daily usage event.
		telemetry: M,
	},
	"packages/db": {
		client: M,
		"data-dir": M,
		migrate: M,
		schema: M,
	},
	"packages/devices": {
		// The wire types of the peer protocol.
		contract: M,
		// Run history between a Replica and a Host, by cursor. It carries
		// rows and Commands, and the engine decides what they mean.
		exchange: M,
		// This computer as a Host: pairing, Device keys, presence.
		host: "devices",
		// The outbound connection to a Host. A port with its adapter.
		links: M,
		// This computer's membership of its home Host.
		membership: "devices",
		offers: "devices",
		// The engine's `Peers` port, composed from the other verticals
		// (rule 5).
		peers: M,
		// Which of a Person's Devices a run may use.
		placement: "devices",
		// Whom the daemon answers, and the certificates.
		reach: M,
		// The Device rows: this computer's own, and the paired ones.
		registry: "devices",
		// Carries actions and work to the Hosts.
		relay: M,
		secrets: "secrets",
		// The execution port for a Device behind a Host.
		work: M,
	},
	"packages/engine": {
		// The guided setup of an agent CLI and of a decider.
		"agent-setup": "agents",
		// What a Replica keeps of a Space for the other Replicas, by hash.
		archive: M,
		// The store of the files a run keeps.
		artifacts: M,
		assistant: "assistant",
		// The removal of what ended runs left on this computer.
		cleanup: "runs",
		// The types the engine's ports name.
		contract: M,
		dashboard: "dashboard",
		// The execution port (`Device`): how a command, a tool call or a web
		// request of a step runs on this computer. Not the Devices a person
		// pairs and offers: those are `devices`.
		device: M,
		// This computer's configuration in its Device document. It holds the
		// secrets of this computer too, until `secrets` has its own vertical.
		"device-config": "settings",
		// The synced documents (Yjs).
		documents: M,
		flows: "flows",
		// It walks a flow (decision 9 of the hexagon series).
		graph: M,
		knowledge: "knowledge",
		// The keeper of the names a Lease node holds.
		leases: M,
		// The event log: the one door to a run's facts.
		log: M,
		// The store of what a Since last run node saw.
		memory: M,
		// The `ollama serve` Night Shift finds or starts, and its models.
		ollama: M,
		// The plan of where a run's steps run, made once at the start.
		placement: "runs",
		projects: "projects",
		// The read model of a run.
		read: "runs",
		// The start, the walk and the actions of a run.
		run: "runs",
		// The store of a run's own folder.
		"run-folders": M,
		// A run's status and the actions it allows.
		"run-status": "runs",
		schedules: "schedules",
		// The keeper of the processes a Service node starts.
		services: M,
		// Moments noted for the anonymous usage export.
		usage: M,
		// The store of the kept variables.
		variables: M,
		// The rule for every address this computer connects to.
		"web-access": M,
	},
	"packages/flows": {
		// The flow format is the language every capability speaks (the kernel
		// of the hexagon series). Its parts are mechanisms: the schema
		// (`flow`), the node types, templates, shapes, the checks of a flow,
		// and the flows that ship (`kits`, `starters`). The capability `flows`
		// is what a Project does with its flows.
		assistant: "assistant",
		// The built-in agents, and who answers for each.
		builtin: "assistant",
		// The edits of the flow editor on its draft.
		draft: "flows",
		flow: M,
		// The built-in harnesses as a person sees them.
		harnesses: "agents",
		kits: M,
		lists: M,
		nodes: M,
		presets: M,
		// Agent Profiles and Model Profiles.
		profiles: "agents",
		recipes: M,
		schedules: "schedules",
		secrets: "secrets",
		sections: M,
		shapes: M,
		starters: M,
		template: M,
		validate: M,
	},
	"packages/insights": {
		client: M,
		ingest: "ingest",
		migrate: M,
		// The SQL of each admin page: what its numbers mean.
		queries: "reports",
		schema: M,
	},
	"packages/notifications": {
		// The port every way to reach a screen implements, and Web Push.
		channels: M,
		// The keys of a notification, what a push carries, where a tap goes.
		contract: M,
		// The log of what the notifier sent.
		deliveries: M,
		// The channel to this computer's own desktop.
		desktop: M,
		// The rules that decide whom to tell, about what, on which screen.
		notifier: "notifications",
		// A Person's notification settings. Not this computer's settings.
		settings: "notifications",
		// The push targets of each Person.
		targets: "notifications",
	},
	"packages/semconv": {
		registry: M,
	},
	"packages/telemetry": {
		conventions: M,
		otlp: M,
		requests: M,
		// The runs of this computer as spans and metric points.
		runs: "runs",
		// The environment of a harness session while the export is on.
		sessions: M,
		usage: M,
	},
};
