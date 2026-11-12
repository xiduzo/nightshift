/**
 * What a write changes, and which reads that makes stale: the one table of
 * both apps. The live cache reads these again when the stream says
 * something changed. The query client keeps the reads a synced document
 * holds fresh until it changes.
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
 * What a write changes: a synced document, or a write the stream tells
 * without one. `runs`: a run started, changed or ended. `projects`: a Host
 * changed the Space's projects. `pause`: a pause tonight began or ended.
 * `learnings`: a person kept or deleted learnings.
 */
export type Change = DocumentKind | "runs" | "projects" | "pause" | "learnings";

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
	// change them.
	flows: {
		holds: [
			["flows", "list"],
			["flows", "get"],
			["flows", "map"],
			["flows", "notices"],
			["flows", "export"],
			["schedules", "list"],
		],
		also: [["flows"]],
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
};

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
