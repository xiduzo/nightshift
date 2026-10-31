import type { EngineEventType, EnginePayloads } from "./events";
import type {
	HistoryRows,
	HistoryRun,
	HistorySession,
	HistoryStep,
} from "./history";

/**
 * The fields that name a place on the disk of a run's Walker (its
 * worktree, its transcripts and command logs), in one place, next to the
 * fields that name a Person (`PERSON_FIELDS`). They are private to the
 * Walker's owner: the exchange keeps them with that Person's Replicas
 * (`withoutPrivatePaths`).
 *
 * Every event type is listed, those without a path too, so a new event
 * type does not compile until it says which of its fields are paths. A
 * field that cannot hold a path (a number, a fixed set of words) does
 * not compile here either. An event of no run (`ProjectAdded`,
 * `CloneAdded`, `WorktreeRemoved`) never leaves its Replica: its paths
 * are listed all the same.
 */

/** The fields of `T`'s payload that can hold a path. */
type PathField<T extends EngineEventType> = {
	[K in keyof EnginePayloads[T]]-?: string extends EnginePayloads[T][K]
		? K
		: never;
}[keyof EnginePayloads[T]] &
	string;

export const PATH_FIELDS = {
	ProjectAdded: ["repoPath"],
	ProjectRemoved: [],
	ProjectRestored: [],
	CloneAdded: ["path"],
	DeviceJoined: [],
	DeviceRevoked: [],
	DeviceOnline: [],
	DeviceOffline: [],
	MemberJoined: [],
	MemberRemoved: [],
	MemberRoleChanged: [],
	OfferMade: [],
	OfferWithdrawn: [],
	ProjectRenamed: [],
	ProjectMoved: [],
	RunStarted: [],
	WorktreeCreated: ["worktreePath"],
	WorktreeRemoved: ["worktreePath"],
	HandedOff: ["worktreePath"],
	WalkerMoved: [],
	WalkerArrived: [],
	RunResumed: [],
	StepStarted: ["transcriptPath", "logPath"],
	StepReopened: [],
	StepEnded: [],
	VariablesSet: [],
	GateOpened: [],
	SessionStarted: [],
	HarnessSessionAssigned: [],
	SessionUsage: [],
	SessionEnded: [],
	EdgeTaken: [],
	FlowCalled: [],
	ItemsRead: [],
	ItemStarted: [],
	ItemBlocked: [],
	ItemEnded: [],
	WaitStarted: [],
	LeaseTaken: [],
	LeaseReleased: [],
	ServiceStarted: ["cwd", "logPath"],
	ServiceStopped: [],
	WaitEnded: [],
	StopRequested: [],
	StopAfterStepRequested: [],
	StopAfterStepCancelled: [],
	RunEnded: [],
	RunWarned: [],
	Scored: [],
	ScheduleFired: [],
	ScheduleSkipped: [],
	KnowledgeSearched: [],
	KnowledgeRead: [],
	WebhookReceived: [],
} as const satisfies {
	[T in EngineEventType]: readonly PathField<T>[];
};

/** The columns of `R` that hold a string. */
type PathColumn<R> = {
	[K in keyof R]-?: R[K] extends string ? K : never;
}[keyof R] &
	string;

/** The columns of the rows a batch carries that are paths on the Walker's disk. */
const PATH_COLUMNS = {
	runs: ["worktreePath"],
	steps: ["transcriptPath"],
	sessions: [],
} as const satisfies {
	runs: readonly PathColumn<HistoryRun>[];
	steps: readonly PathColumn<HistoryStep>[];
	sessions: readonly PathColumn<HistorySession>[];
};

/** The row with each of `columns` that holds a path set to "". */
function withoutColumns<R extends object>(
	row: R,
	columns: readonly string[],
): R {
	const stripped = { ...row } as Record<string, unknown>;
	for (const column of columns) stripped[column] = "";
	return stripped as R;
}

/**
 * The rows without the Walker's own paths (`PATH_FIELDS`,
 * `PATH_COLUMNS`). Rows keep their shape: a path becomes "", and one
 * that is null (a step without a command log) stays null, so the row
 * still says whether the step has a log. `keep` says per Walker whose
 * paths stay.
 */
export function withoutPrivatePaths(
	rows: HistoryRows,
	keep: (walkerId: string) => boolean = () => false,
): HistoryRows {
	const walkerOf = new Map(rows.runs.map((r) => [r.id, r.walkerId]));
	const strip = (walkerId: string | undefined) =>
		walkerId === undefined || !keep(walkerId);
	const fieldsOf = PATH_FIELDS as Partial<Record<string, readonly string[]>>;
	return {
		runs: rows.runs.map((r) =>
			strip(r.walkerId) ? withoutColumns(r, PATH_COLUMNS.runs) : r,
		),
		steps: rows.steps.map((s) =>
			strip(walkerOf.get(s.runId)) ? withoutColumns(s, PATH_COLUMNS.steps) : s,
		),
		sessions: rows.sessions,
		events: rows.events.map((e) => {
			// A type this Night Shift does not know has no path it can name.
			const fields = fieldsOf[e.type] ?? [];
			if (fields.length === 0 || !strip(e.walkerId)) return e;
			const payload = JSON.parse(e.payload) as Record<string, unknown>;
			let changed = false;
			for (const field of fields) {
				if (typeof payload[field] !== "string") continue;
				payload[field] = "";
				changed = true;
			}
			return changed ? { ...e, payload: JSON.stringify(payload) } : e;
		}),
	};
}
