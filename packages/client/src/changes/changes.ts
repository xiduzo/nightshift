import type { AppRouterClient } from "@nightshift/api/client";

/**
 * What a write changes, and which reads that makes stale: the one table of
 * both apps. The live cache reads these again when the stream says
 * something changed, and when a save on this screen answers (`SAVES`). The
 * query client keeps the reads a synced document holds fresh until it
 * changes.
 */

/**
 * The path of a procedure, the first part of its query key
 * (`["flows", "list"]`). The path of a router stands for every procedure
 * below it (`["flows"]`).
 */
export type QueryPath = readonly string[];

/**
 * A synced document, by the prefix of its name (`flows:<project>`). The
 * Host tells the open screens when one changes (`document-changed`).
 */
export type DocumentKind =
	| "flows"
	| "flows-history"
	| "knowledge"
	| "space"
	| "device"
	| "device-copy";

/**
 * A write the stream tells without a document. `runs`: a run started,
 * changed or ended. `projects`: a Host changed the Space's projects.
 * `pause`: a pause tonight began or ended. `learnings`: a person kept or
 * deleted learnings. `sources`: a run of a knowledge source started or
 * ended.
 */
type StreamChange = "runs" | "projects" | "pause" | "learnings" | "sources";

/**
 * A write that only the screen that saves knows of: the stream does not
 * tell it, so other screens see it when they read again. `secrets`: a
 * secret the Host keeps (of a project, of the Space, Personal). `members`:
 * the Members of the Space and its invitations. `run-memory`: the kept
 * values and what the Since last run nodes saw. `programs`: the programs
 * found on this computer. `copies`: the copies of projects to this
 * computer. `git`: the git setup of a folder. `ollama`: the models of
 * Ollama. `usage`: the anonymous usage of this computer. `screens`: the
 * screens that get notifications. `devices`: the Person's Devices, pairings and phones.
 * `logins`: the login of a CLI tool. `account`: how the owner signs in.
 */
type SaveChange =
	| "secrets"
	| "members"
	| "run-memory"
	| "programs"
	| "copies"
	| "git"
	| "ollama"
	| "usage"
	| "screens"
	| "devices"
	| "logins"
	| "account";

/** What a write changes: a synced document, or a write without one. */
export type Change = DocumentKind | StreamChange | SaveChange;

/** The reads a change makes stale. */
type Stale = {
	/**
	 * Reads that only this change changes. They stay fresh until it comes,
	 * 10 minutes at most: a Host of an older version does not tell. Only a
	 * synced document holds reads, because the stream says when it changes.
	 */
	holds?: readonly QueryPath[];
	/** Reads that change in other ways too. They stay fresh for a minute. */
	also?: readonly QueryPath[];
};

/**
 * What each change makes stale. A path stands for every read below it. Only
 * a synced document holds reads.
 */
const STALE: {
	[C in Change]: C extends DocumentKind ? Stale : Omit<Stale, "holds">;
} = {
	// Each run carries into the lists that count it, the dashboard's
	// numbers, a schedule's last start, the run counts of the projects (the
	// sidebar, the phone's Projects), and the learnings that wait (a step
	// that ends may propose some). Each step that ends saves the values of
	// the kept variables and what the Since last run nodes saw.
	runs: {
		also: [
			["runs", "list"],
			["dashboard"],
			["schedules", "list"],
			["projects", "list"],
			["knowledge", "learnings"],
			["knowledge", "review"],
			["flows", "kept"],
			["flows", "memory"],
		],
	},
	// Every read of projects: the lists, one project's page, its sources.
	projects: {
		also: [["projects"], ["dashboard"], ["schedules", "list"]],
	},
	pause: { also: [["schedules", "list"]] },
	// The Knowledge page shows each source's last sync. Its list reconciles
	// the folder first, so not every change of a run reads it.
	sources: { also: [["knowledge", "get"]] },
	// The Knowledge page counts the learnings that wait.
	learnings: {
		also: [
			["knowledge", "learnings"],
			["knowledge", "review"],
			["knowledge", "get"],
		],
	},
	// A project's flows, their notices and its schedules. The kept values
	// and the memory of a flow's runs are not in the document: the runs
	// change them. The lists that say which flows use a profile, a
	// connection, a CLI tool or a secret, and the flows that fill the
	// knowledge (its sources, and the sources that need a look), read the
	// flows.
	flows: {
		holds: [
			["flows", "list"],
			["flows", "get"],
			["flows", "map"],
			["flows", "notices"],
			["flows", "export"],
			["schedules", "list"],
		],
		also: [
			["flows"],
			["profiles", "list"],
			["connections", "list"],
			["cliTools", "list"],
			["projects", "secrets"],
			["projects", "spaceSecrets"],
			["knowledge", "get"],
			["knowledge", "review"],
		],
	},
	"flows-history": {
		holds: [
			["flows", "revisions"],
			["flows", "revision"],
		],
	},
	// A project's knowledge: its files, the Map, the questions. Search,
	// search by meaning and its evaluation change too while this computer
	// prepares its search. They stay held with the rest.
	knowledge: { holds: [["knowledge"]] },
	// A Space's projects, its Members and its policy.
	space: {
		holds: [
			["projects", "list"],
			["spaces"],
			["members"],
			["dashboard"],
			["schedules", "list"],
		],
		also: [["projects"]],
	},
	// This computer: its profiles, connections and secrets, CLI tools,
	// harnesses and Custom Agents, settings, Offers and deciders. A check
	// of a CLI or a program, the programs found, or the tools of a
	// connection also change on their own: a program installed outside
	// Night Shift.
	device: {
		holds: [
			["profiles"],
			["connections", "list"],
			["harnesses", "list"],
			["cliTools", "list"],
			["settings"],
			["offers"],
			["deciders"],
		],
		also: [["connections"], ["harnesses"], ["cliTools"]],
	},
	// A copy of another computer's document: the Devices, and the Offers.
	"device-copy": { also: [["devices"], ["offers"]] },
	// The Secrets page lists this computer's and the Personal secrets.
	secrets: {
		also: [
			["projects", "secrets"],
			["projects", "spaceSecrets"],
			["connections", "list"],
		],
	},
	members: { also: [["members"]] },
	"run-memory": {
		also: [
			["flows", "kept"],
			["flows", "memory"],
		],
	},
	programs: { also: [["programs"]] },
	copies: { also: [["projects", "copies"]] },
	git: { also: [["projects", "check"]] },
	ollama: { also: [["ollama"]] },
	usage: { also: [["usage"]] },
	// The settings name the screens too.
	screens: { also: [["notifications"]] },
	devices: { also: [["devices"]] },
	// The tools list their logins, and the connections list them.
	logins: {
		also: [
			["cliTools", "list"],
			["connections", "list"],
		],
	},
	account: { also: [["account"]] },
};

/** The dotted path of each procedure under `Prefix` (`flows.save`). */
type PathsOf<T, Prefix extends string = ""> = {
	[K in keyof T & string]: T[K] extends (...args: never[]) => unknown
		? `${Prefix}${K}`
		: PathsOf<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** A procedure of the API, by its dotted path (`flows.save`). */
type RoutePath = PathsOf<AppRouterClient>;

/**
 * What each save route writes, once it answers: the one place that says
 * what a save makes stale. While the live cache follows the Host, a save
 * that succeeds reads these again, so a screen needs no read of its own.
 * A test checks that every route of the API that is not a read has a row.
 *
 * An empty row: the screen owns the read (`useRunActed`, `useAnswerGate`,
 * `useSettleLearnings`, or `spaceChanged` when every read changes), a job
 * that the screen follows (its end calls `changed`), or nothing a screen
 * reads changes. A row names a document the route writes only for
 * some inputs too. It never names what changes later: another computer
 * moves its own secret, and its copy here follows with the stream.
 */
export const SAVES: {
	readonly [Route in RoutePath]?: readonly Change[];
} = {
	// Every read changes with the Space a person works in.
	"spaces.switch": [],
	"spaces.create": [],
	"invitations.accept": [],
	"spaces.setUsage": ["space"],
	"members.invite": ["members"],
	"members.cancelInvitation": ["members"],
	"members.setRole": ["members"],
	"members.remove": ["members"],

	"projects.add": ["space"],
	"projects.addWithoutFolder": ["space"],
	"projects.useFolder": ["space"],
	"projects.rename": ["space"],
	"projects.remove": ["space"],
	"projects.move": ["space"],
	"projects.copyHere": ["copies"],
	// A copy from GitHub is a job: the screen follows it (`gitHubClone`).
	"projects.cloneFromGitHub": [],
	"projects.setUpGit": ["git"],
	// The installer runs on its own: the person checks again.
	"projects.installGit": [],
	"projects.setSecret": ["secrets"],
	"projects.removeSecret": ["secrets"],
	"projects.moveSecretOut": ["secrets"],
	"projects.moveSecretIn": ["secrets"],
	"projects.moveSecretFromDevice": ["secrets"],
	"projects.setSpaceSecret": ["secrets"],
	"projects.removeSpaceSecret": ["secrets"],
	"projects.moveSecretToSpace": ["secrets"],
	"projects.moveSecretFromSpace": ["secrets"],

	"flows.save": ["flows", "flows-history"],
	"flows.restore": ["flows", "flows-history"],
	"flows.import": ["flows", "flows-history"],
	"flows.copy": ["flows", "flows-history"],
	"flows.remove": ["flows"],
	"flows.dismissNotice": ["flows"],
	"flows.resetKept": ["run-memory"],
	"flows.forgetMemory": ["run-memory"],
	"schedules.save": ["flows"],
	"schedules.pauseTonight": ["pause"],
	"schedules.resumeTonight": ["pause"],

	"knowledge.saveSource": ["flows"],
	"knowledge.removeSource": ["flows", "knowledge"],
	"knowledge.syncSource": ["runs", "sources"],
	"knowledge.markNotTopic": ["knowledge"],
	"knowledge.markQuestion": ["knowledge"],
	"knowledge.setMeaning": ["knowledge"],
	"knowledge.keepLearning": [],
	"knowledge.deleteLearning": [],

	"gates.resolve": [],
	"schedules.runNow": [],
	"runs.start": [],
	"runs.stop": [],
	"runs.resume": [],
	"runs.restartStep": [],
	"runs.rerun": [],
	"runs.move": [],
	"runs.signal": [],
	"runs.releaseLease": [],
	// The screen keeps the answer itself.
	"runs.useful": [],
	"runs.takeOver": [],

	// It answers with every setting, and the screen keeps them.
	"notifications.settings.save": [],
	"notifications.targets.register": ["screens"],
	"notifications.targets.remove": ["screens"],

	// The Host's addresses show on the Devices page too.
	"settings.save": ["device", "devices"],
	"usage.resetId": ["usage"],
	"profiles.save": ["device"],
	"profiles.remove": ["device"],
	"connections.save": ["device"],
	"connections.remove": ["device"],
	// A Personal secret shows in this computer's list.
	"connections.setSecret": ["device"],
	"connections.removeSecret": ["device"],
	"connections.moveSecret": ["device"],
	"cliTools.save": ["device"],
	"cliTools.remove": ["device"],
	"cliTools.signIn": ["logins"],
	"harnesses.add": ["device"],
	"harnesses.remove": ["device"],
	"harnesses.saveCustom": ["device"],
	"programs.setUp": ["device", "programs"],
	"offers.make": ["device"],
	"offers.withdraw": ["device"],
	"ollama.pull": ["ollama"],
	// The setup of an agent or a decider is a job.
	"agentSetup.install": [],
	"agentSetup.signIn": [],
	"agentSetup.sendCode": [],
	"agentSetup.cancel": [],
	"deciderSetup.installOllama": [],
	"deciderSetup.useLocal": [],
	"deciderSetup.useTypesafe": [],
	"deciderSetup.cancel": [],
	"account.setLogin": ["account"],

	// That device moves its own value later.
	"devices.moveSecret": ["secrets"],
	// It holds the code: no list shows it.
	"devices.review": [],
	"devices.approve": ["devices"],
	"devices.deny": ["devices"],
	"devices.revoke": ["devices"],
	"devices.forget": ["devices"],
	"devices.removePhone": ["devices"],
	"devices.merge.run": [],
	"devices.leave": [],
};

/**
 * What the save route at `path` (`["flows", "save"]`, the first part of
 * its mutation key) wrote. None for a route without a row.
 */
export function savedBy(path: readonly string[]): readonly Change[] {
	return SAVES[path.join(".") as RoutePath] ?? [];
}

/** The order the reads go out in: the order of `STALE`. */
const CHANGES = Object.keys(STALE) as Change[];

const DOCUMENT_KINDS: ReadonlySet<string> = new Set<DocumentKind>([
	"flows",
	"flows-history",
	"knowledge",
	"space",
	"device",
	"device-copy",
]);

/** The reads `change` holds: none unless it is a synced document. */
function holdsOf(change: Change): readonly QueryPath[] {
	const stale: Stale = STALE[change];
	return stale.holds ?? [];
}

/** Whether `inner` is `outer` or a path below it. */
function within(inner: QueryPath, outer: QueryPath): boolean {
	return (
		outer.length <= inner.length &&
		outer.every((part, index) => inner[index] === part)
	);
}

/** The paths once each, without a path that another of them stands for. */
function covering(paths: readonly QueryPath[]): QueryPath[] {
	const kept: QueryPath[] = [];
	paths.forEach((path, index) => {
		const covered = paths.some(
			(other, at) =>
				within(path, other) && (other.length < path.length || at < index),
		);
		if (!covered) kept.push(path);
	});
	return kept;
}

/** The reads that `changes` make stale, each once. */
export function staleAfter(changes: Iterable<Change>): QueryPath[] {
	const wanted = new Set(changes);
	return covering(
		CHANGES.filter((change) => wanted.has(change)).flatMap((change) => [
			...holdsOf(change),
			...(STALE[change].also ?? []),
		]),
	);
}

/**
 * The reads the synced documents hold: they stay fresh until the stream
 * says their document changed.
 */
export function heldByDocuments(): QueryPath[] {
	return covering(CHANGES.flatMap(holdsOf));
}

/**
 * The kind of a synced document by its name (`flows:shop` is `flows`), or
 * null for a name this screen does not know.
 */
export function documentOf(name: string): DocumentKind | null {
	const prefix = name.split(":")[0] ?? "";
	return DOCUMENT_KINDS.has(prefix) ? (prefix as DocumentKind) : null;
}
