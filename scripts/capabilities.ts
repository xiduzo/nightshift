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
 *   capabilities. A workspace has at most one. It may import every
 *   capability, so V2 and V5 do not apply to it. No vertical imports it:
 *   only the routes, the entry folders and the entry files do. In an app it
 *   is `shared/shell`: the frame of the app, which puts the features on the
 *   screen together. Rule (h) of `scripts/check-verticals.ts` closes that
 *   folder. In a package without rings it is one vertical that only the
 *   entry files of the package import (`live` of `packages/client`). The
 *   capability check closes it. A server package has none: it composes its
 *   slices in a `wire.ts` outside the verticals.
 *
 * The rules (the check has the details):
 *
 * - V1a Every vertical on disk is in VERTICALS, and every entry is on disk.
 * - V1b A capability vertical has the folder name of its capability. A
 *   vertical that is part of a capability under another name is on the
 *   rename debt list (`scripts/capability-debt.txt`). Two verticals of one
 *   workspace with one capability become one vertical with sub-verticals.
 * - V2 A mechanism imports no capability of its workspace. The wiring may,
 *   and no vertical imports the wiring.
 * - V5 A capability imports at most 5 other capability verticals of its
 *   workspace.
 *
 * How to place a vertical:
 *
 * 1. It holds the rules or the data of a product area: give it that
 *    capability, also when its folder has another name (engine
 *    `placement` and `cleanup` are `runs`).
 * 2. It only serves other verticals and has no product rule of its own:
 *    MECHANISM. Say why in a comment when the name does not.
 * 3. An app's `shared/<name>` piece is a mechanism. The one exception is
 *    rule 4.
 * 4. An app's `shared/shell` that composes its features is WIRING. A shell
 *    that imports no feature is a mechanism (the Insights admin: its route
 *    passes in what the frame shows). An app that composes in its entry
 *    files has no wiring piece (`apps/desktop`, `apps/server`).
 * 5. A vertical of a server package that composes the others is a
 *    mechanism. Its imports of capabilities are V2 debt until the wiring
 *    moves to a `wire.ts` outside the verticals (`devices/peers` did, to
 *    `wire-peers.ts`).
 * 6. A package without rings has no `wire.ts`. When one vertical of it
 *    composes its capabilities, and its work is that composition, it is
 *    WIRING (`client/live`). Give a vertical WIRING only when its rules are
 *    about how the capabilities work together. A vertical that could take
 *    what it needs as arguments is a mechanism.
 *
 * A vertical is named as `scripts/check-verticals.ts` names it: its path in
 * `src/` (`graph`, `features/runs`, `shared/api`).
 */

import { APP_DESKTOP } from "./capabilities/apps-desktop";
import { APP_INSIGHTS } from "./capabilities/apps-insights";
import { APP_MOBILE } from "./capabilities/apps-mobile";
import { APP_SERVER } from "./capabilities/apps-server";
import { APP_WEB } from "./capabilities/apps-web";
import { MECHANISM, WIRING } from "./capabilities/kinds";
import { PACKAGE_AGENTS } from "./capabilities/packages-agents";
import { PACKAGE_API } from "./capabilities/packages-api";
import { PACKAGE_AUTH } from "./capabilities/packages-auth";
import { PACKAGE_CLIENT } from "./capabilities/packages-client";
import { PACKAGE_DAEMON } from "./capabilities/packages-daemon";
import { PACKAGE_DB } from "./capabilities/packages-db";
import { PACKAGE_DEVICES } from "./capabilities/packages-devices";
import { PACKAGE_ENGINE } from "./capabilities/packages-engine";
import { PACKAGE_FLOWS } from "./capabilities/packages-flows";
import { PACKAGE_INSIGHTS } from "./capabilities/packages-insights";
import { PACKAGE_NOTIFICATIONS } from "./capabilities/packages-notifications";
import { PACKAGE_SEMCONV } from "./capabilities/packages-semconv";
import { PACKAGE_TELEMETRY } from "./capabilities/packages-telemetry";

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
	decider: {
		word: "Decider",
		meaning:
			"The models that decide for a Decision or a Value node: which one, its default model and setup.",
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
	"space-move": {
		word: "Space move",
		meaning:
			"Projects that go from one Space to another as one operation: a person's move, the merge on join and the split on leave.",
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

export { MECHANISM, WIRING };

export type Place = Capability | typeof MECHANISM | typeof WIRING;

/**
 * Each workspace, and each of its verticals with its capability,
 * MECHANISM or WIRING. Sorted by workspace, then by vertical. Each
 * workspace has its own file in `scripts/capabilities/`.
 */
export const VERTICALS: Record<string, Record<string, Place>> = {
	"apps/desktop": APP_DESKTOP,
	"apps/insights": APP_INSIGHTS,
	"apps/mobile": APP_MOBILE,
	"apps/server": APP_SERVER,
	"apps/web": APP_WEB,
	"packages/agents": PACKAGE_AGENTS,
	"packages/api": PACKAGE_API,
	"packages/auth": PACKAGE_AUTH,
	"packages/client": PACKAGE_CLIENT,
	"packages/daemon": PACKAGE_DAEMON,
	"packages/db": PACKAGE_DB,
	"packages/devices": PACKAGE_DEVICES,
	"packages/engine": PACKAGE_ENGINE,
	"packages/flows": PACKAGE_FLOWS,
	"packages/insights": PACKAGE_INSIGHTS,
	"packages/notifications": PACKAGE_NOTIFICATIONS,
	"packages/semconv": PACKAGE_SEMCONV,
	"packages/telemetry": PACKAGE_TELEMETRY,
};
