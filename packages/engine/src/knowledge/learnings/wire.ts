import type { AgentEvent } from "@nightshift/agents/types";
import { now as timeNow } from "@nightshift/time";
import type { Actor } from "../../contract";
import type { TranscriptEntry } from "../../log";
import { followEndedRuns } from "./adapters/in/follow-ended-runs";
import { fsLearningFolder } from "./adapters/out/fs-learning-folder";
import { countWaitingNotes } from "./application/count-waiting-notes";
import { hearReconcile } from "./application/hear-reconcile";
import { keepReportedLearnings } from "./application/keep-reported-learnings";
import { listKnownLearnings } from "./application/list-known-learnings";
import { listProjectLearnings } from "./application/list-project-learnings";
import { listWaitingLearnings } from "./application/list-waiting-learnings";
import { lookBackAtRun } from "./application/look-back-at-run";
import type {
	AskLearner,
	CloseNotes,
	ContentArchive,
	FolderHolds,
	LearningEntries,
	LearningsAccess,
	LearningsNotifications,
	RunsToLearnFrom,
	SpaceStatus,
} from "./application/ports";
import { proposeFromRun } from "./application/propose-from-run";
import { proposeLearnings } from "./application/propose-learnings";
import { readLearnsFromRuns } from "./application/read-learns-from-runs";
import { setLearnsFromRuns } from "./application/set-learns-from-runs";
import { settleLearning } from "./application/settle-learning";
import { settleNote } from "./application/settle-note";
import { tellLearning } from "./application/tell-learning";
import {
	createLookQueue,
	LOOK_TIMEOUT_MS,
	type RunLookBack,
} from "./domain/look-back";
import type {
	LearningStep,
	NotePerson,
	ProjectLearning,
	WaitingLearning,
	WaitingNote,
} from "./domain/waiting";

/**
 * The wiring of knowledge/learnings: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/learnings: the ports another part fills, and what the real adapter stands on. */
export type LearningsDeps = {
	access: LearningsAccess;
	/** The knowledge folders on this computer (`files`). */
	folders: { folder(projectId: string): string };
	documents: LearningEntries;
	/** The content by hash: here, and at the Space's Host. */
	archive: ContentArchive;
	status: SpaceStatus;
	/** Holds the folder as a step does: `settle` changes it, and the reconcile at `done` publishes that. */
	startStep: FolderHolds["startStep"];
	notifications: LearningsNotifications;
	/** Which notes are close to others. Absent: the list has no `nearTo`. */
	closeNotes?: CloseNotes;
	/** The clock. Default `now`. */
	now?: () => number;
};

/** What the look back at runs is given when it starts: the runs, the Learner and the read model's lines. */
export type FollowRunsDeps = {
	runs: RunsToLearnFrom;
	/** The Learner of this computer. A failure is logged: the run is not looked at again. */
	learn: AskLearner;
	/** The plain lines of a transcript's end: `transcriptLines` of the read model. */
	lines: (entries: readonly TranscriptEntry[], max: number) => string[];
	/** How long one look may take. Default 5 minutes. */
	timeoutMs?: number;
};

/** Learnings from runs that ended (ADR 37), one look at a time. */
export type RunLearnings = {
	/** Looks back at one run of a Space now, in the queue. */
	lookBack(spaceId: string, runId: string): Promise<RunLookBack>;
	/** Looks back at each run this computer walks when it ends. Returns the stop. */
	follow(): () => void;
	/** Resolves when every look in the queue is done. */
	idle(): Promise<void>;
};

/** The learnings of the projects on this computer, bound to their ports. */
export type Learnings = {
	/** Adds what an agent of a run's step proposes to learn to its file (`proposeLearnings`). */
	propose(
		projectId: string,
		step: LearningStep,
		notes: readonly string[],
	): Promise<void>;
	/** Proposes what Night Shift learned from a run that ended (`proposeFromRun`). */
	proposeFromRun(
		projectId: string,
		runId: string,
		notes: readonly string[],
	): Promise<void>;
	/** The notes the project has on this computer, waiting and kept (`listKnownLearnings`). */
	known(projectId: string): Promise<string[]>;
	/** The session's events, with the learnings of its reports proposed (`keepReportedLearnings`). */
	keepReported(
		events: AsyncIterable<AgentEvent>,
		projectId: string,
		step: LearningStep,
	): AsyncGenerator<AgentEvent>;
	/** What waits for a person, newest first (`listWaitingLearnings`). */
	waiting(
		projectId: string,
		options?: { onlyHere?: boolean },
	): Promise<WaitingLearning[]>;
	/** What waits for a person in these projects, each with its project, newest first (`listProjectLearnings`). */
	ofProjects(projectIds: readonly string[]): Promise<ProjectLearning[]>;
	/** How many notes wait (`countWaitingNotes`). */
	count(projectId: string): Promise<number>;
	/** Keeps or deletes one step's proposed learnings (`settleLearning`). */
	settle(
		actor: Actor,
		spaceId: string,
		projectId: string,
		id: string,
		decision: "keep" | "delete",
	): Promise<void>;
	/** Keeps or deletes one note of a learning that waits (`settleNote`). */
	settleNote(
		actor: Actor,
		spaceId: string,
		projectId: string,
		note: WaitingNote,
		decision: "keep" | "delete",
		by: NotePerson,
	): Promise<void>;
	/** Keeps a note a person wrote (`tellLearning`). */
	tell(
		actor: Actor,
		spaceId: string,
		projectId: string,
		note: string,
		by: NotePerson,
		replaces?: WaitingNote,
	): Promise<void>;
	/** A reconcile ended (`hearReconcile`). */
	reconciled: ReturnType<typeof hearReconcile>;
	/** Whether Night Shift proposes learnings from the project's runs (`readLearnsFromRuns`). */
	learnsFromRuns(projectId: string): Promise<boolean>;
	/** Turns the learnings from runs on or off (`setLearnsFromRuns`). */
	setLearnsFromRuns(
		actor: Actor,
		spaceId: string,
		projectId: string,
		on: boolean,
	): Promise<void>;
	/** The look back at runs that end, over these learnings (`lookBackAtRun`). */
	followRuns(deps: FollowRunsDeps): RunLearnings;
};

export function wireLearnings(deps: LearningsDeps): Learnings {
	const folder = fsLearningFolder(deps.folders);
	const { documents, archive, status, notifications } = deps;
	const holds = { startStep: deps.startStep };
	const now = deps.now ?? timeNow;

	const propose = proposeLearnings({ folder });
	const fromRun = proposeFromRun({ holds, propose });
	const known = listKnownLearnings({ status, documents, archive });
	const keepReported = keepReportedLearnings({ propose });
	const waiting = listWaitingLearnings({
		status,
		documents,
		archive,
		notifications,
		...(deps.closeNotes ? { closeNotes: deps.closeNotes } : {}),
	});
	const ofProjects = listProjectLearnings({ waiting });
	const count = countWaitingNotes({ status, documents, archive });
	const settle = settleLearning({
		access: deps.access,
		folder,
		documents,
		holds,
	});
	const settleOne = settleNote({
		access: deps.access,
		folder,
		documents,
		holds,
		now,
	});
	const tell = tellLearning({
		access: deps.access,
		folder,
		documents,
		holds,
		now,
	});
	const learnsFromRuns = readLearnsFromRuns({ documents });
	const setLearns = setLearnsFromRuns({ access: deps.access, documents });

	return {
		propose: (projectId, step, notes) => propose({ projectId, step, notes }),
		proposeFromRun: (projectId, runId, notes) =>
			fromRun({ projectId, runId, notes }),
		known: (projectId) => known({ projectId }),
		keepReported: (events, projectId, step) =>
			keepReported({ events, projectId, step }),
		waiting: (projectId, options) =>
			waiting({
				projectId,
				...(options?.onlyHere !== undefined
					? { onlyHere: options.onlyHere }
					: {}),
			}),
		ofProjects: (projectIds) => ofProjects({ projectIds }),
		count: (projectId) => count({ projectId }),
		settle: (actor, spaceId, projectId, id, decision) =>
			settle({ actor, spaceId, projectId, id, decision }),
		settleNote: (actor, spaceId, projectId, note, decision, by) =>
			settleOne({ actor, spaceId, projectId, note, decision, by }),
		tell: (actor, spaceId, projectId, note, by, replaces) =>
			tell({
				actor,
				spaceId,
				projectId,
				note,
				by,
				...(replaces ? { replaces } : {}),
			}),
		reconciled: hearReconcile({ notifications, known: new Map() }),
		learnsFromRuns: (projectId) => learnsFromRuns({ projectId }),
		setLearnsFromRuns: (actor, spaceId, projectId, on) =>
			setLearns({ actor, spaceId, projectId, on }),
		followRuns(late) {
			const queue = createLookQueue();
			const lookBack = lookBackAtRun({
				runs: late.runs,
				learn: late.learn,
				lines: late.lines,
				timeoutMs: late.timeoutMs ?? LOOK_TIMEOUT_MS,
				queue,
				learnsFromRuns,
				known,
				proposeFromRun: fromRun,
			});
			return {
				lookBack: (spaceId, runId) => lookBack({ spaceId, runId }),
				follow: () => followEndedRuns(late.runs, lookBack),
				idle: queue.idle,
			};
		},
	};
}
