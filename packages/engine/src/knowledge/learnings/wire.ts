import { now as timeNow } from "@nightshift/time";
import type { Access } from "../../access";
import type { TranscriptEntry } from "../../log";
import type { CloseNotes } from "../search";
import type {
	KnowledgeDocuments,
	KnowledgeReconciler,
	SpaceHostStatus,
} from "../sync";
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
	LearningsNotifications,
	RunsToLearnFrom,
} from "./application/ports";
import { proposeFromRun } from "./application/propose-from-run";
import { proposeLearnings } from "./application/propose-learnings";
import { readLearnsFromRuns } from "./application/read-learns-from-runs";
import { setLearnsFromRuns } from "./application/set-learns-from-runs";
import { settleLearning } from "./application/settle-learning";
import { settleNote } from "./application/settle-note";
import { tellLearning } from "./application/tell-learning";
import { createLookQueue, LOOK_TIMEOUT_MS } from "./domain/look-back";
import type { ListedReads } from "./domain/proposed";

/**
 * The wiring of knowledge/learnings: the one place that builds its real adapters
 * and binds each use case to its ports.
 */

/** What the knowledge gives knowledge/learnings: the ports another part fills, and what the real adapter stands on. */
export type LearningsDeps = {
	access: Pick<Access, "openSpace">;
	/** The knowledge folders on this computer (`files`). */
	folders: { folder(projectId: string): string };
	/** The knowledge documents of the projects (`sync`). */
	documents: Pick<KnowledgeDocuments, "open">;
	/** The content by hash: here, and at the Space's Host. */
	archive: ListedReads["archive"];
	status: Pick<SpaceHostStatus, "spaceOf" | "heard">;
	/** Holds the folder as a step does: `settle` changes it, and the reconcile at `done` publishes that. */
	holds: Pick<KnowledgeReconciler, "startStep">;
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
	lookBack: ReturnType<typeof lookBackAtRun>;
	/** Looks back at each run this computer walks when it ends. Returns the stop. */
	follow(): () => void;
	/** Resolves when every look in the queue is done. */
	idle(): Promise<void>;
};

/** The learnings of the projects on this computer, bound to their ports. */
export type Learnings = {
	propose: ReturnType<typeof proposeLearnings>;
	proposeFromRun: ReturnType<typeof proposeFromRun>;
	known: ReturnType<typeof listKnownLearnings>;
	keepReported: ReturnType<typeof keepReportedLearnings>;
	waiting: ReturnType<typeof listWaitingLearnings>;
	ofProjects: ReturnType<typeof listProjectLearnings>;
	count: ReturnType<typeof countWaitingNotes>;
	settle: ReturnType<typeof settleLearning>;
	settleNote: ReturnType<typeof settleNote>;
	tell: ReturnType<typeof tellLearning>;
	reconciled: ReturnType<typeof hearReconcile>;
	learnsFromRuns: ReturnType<typeof readLearnsFromRuns>;
	setLearnsFromRuns: ReturnType<typeof setLearnsFromRuns>;
	/** The look back at runs that end, over these learnings (`lookBackAtRun`). */
	followRuns(deps: FollowRunsDeps): RunLearnings;
};

export function wireLearnings(deps: LearningsDeps): Learnings {
	const folder = fsLearningFolder(deps.folders);
	const { documents, archive, status, holds, notifications } = deps;
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
	const learnsFromRuns = readLearnsFromRuns({ documents });
	const { access } = deps;

	return {
		propose,
		proposeFromRun: fromRun,
		known,
		keepReported,
		waiting,
		ofProjects,
		count,
		settle: settleLearning({ access, folder, documents, holds }),
		settleNote: settleNote({ access, folder, documents, holds, now }),
		tell: tellLearning({ access, folder, documents, holds, now }),
		reconciled: hearReconcile({ notifications, known: new Map() }),
		learnsFromRuns,
		setLearnsFromRuns: setLearnsFromRuns({ access, documents }),
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
				lookBack,
				follow: () => followEndedRuns(late.runs, lookBack),
				idle: queue.idle,
			};
		},
	};
}
