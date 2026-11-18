import type { agentSession, run, step } from "@nightshift/db/schema";
import type { ForeignEvent } from "../run-log";

/**
 * The rows of runs as one batch of the exchange carries them, and why a
 * Replica refuses a batch (`history.ts`).
 */

/**
 * A run's row, as a batch of the exchange carries it: its columns, with
 * its time in epoch ms. The plan's columns are as `planColumns` keeps them.
 */
export type HistoryRun = {
	id: string;
	spaceId: string;
	projectId: string;
	flowName: string | null;
	flow: string;
	bodyFlows: string;
	flowRevision: string | null;
	bodyFlowRevisions: string;
	title: string;
	worktreePath: string;
	branch: string;
	baseRef: string;
	walkerId: string;
	deviceId: string | null;
	placements: string | null;
	deviceNames: string | null;
	fallbacks: string | null;
	startedBy: string | null;
	createdAt: number;
};
/** A step's row, as a batch of the exchange carries it. */
export type HistoryStep = {
	id: string;
	spaceId: string;
	runId: string;
	nodeId: string;
	nodeType: string;
	visit: number;
	transcriptPath: string;
	deviceId: string | null;
	createdAt: number;
};
/** An agent session's row, as a batch of the exchange carries it. */
export type HistorySession = {
	id: string;
	spaceId: string;
	runId: string;
	stepId: string;
	harnessSessionId: string | null;
	prompt: string;
	createdAt: number;
};

/** Whether `A` and `B` are the same type. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** A table's row as a batch carries it. */
type Carried<R extends { createdAt: Date }> = Omit<R, "createdAt"> & {
	createdAt: number;
};
// The rows a batch carries are the tables' rows: a column added to one
// fails the build here until the batch carries it (and the wire schema
// of `@nightshift/devices` follows).
const carriesTheRows: [
	Same<HistoryRun, Carried<typeof run.$inferSelect>>,
	Same<HistoryStep, Carried<typeof step.$inferSelect>>,
	Same<HistorySession, Carried<typeof agentSession.$inferSelect>>,
] = [true, true, true];
void carriesTheRows;

/** Rows of runs, as one batch of the exchange carries them. */
export type HistoryRows = {
	runs: HistoryRun[];
	steps: HistoryStep[];
	sessions: HistorySession[];
	events: ForeignEvent[];
};

/** Per Space, per Walker: the last `walker_seq` a Replica has. */
export type HistoryCursors = Record<string, Record<string, number>>;

/** A batch with no rows. */
export const NO_ROWS: HistoryRows = {
	runs: [],
	steps: [],
	sessions: [],
	events: [],
};

/** The receiver lacks a run's project: its Space document has not reached it yet. */
export class MissingProjectError extends Error {
	constructor(readonly projectIds: string[]) {
		super(
			"This Device does not have the project of these runs yet. They come again once it has.",
		);
	}
}

/** A batch with a row its sender may not send: a run another Device walks, or a Space it is not in. */
export class ForeignRowsError extends Error {}

/** A step this Replica walked, as files: its transcript and its command log (null when it has none). */
export type OwnStepFiles = {
	spaceId: string;
	runId: string;
	transcript: string | null;
	log: string | null;
};
