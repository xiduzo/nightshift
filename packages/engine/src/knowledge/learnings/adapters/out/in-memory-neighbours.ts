import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import type { TranscriptEntry } from "../../../../log";
import { inMemorySearch } from "../../../search/adapters/out/in-memory-search";
import { inMemorySync } from "../../../sync/adapters/out/in-memory-sync";
import type {
	AskLearner,
	LearningsNotifications,
	RunsToLearnFrom,
} from "../../application/ports";
import type { EndedRun, RecentRun } from "../../domain/look-back";
import { inMemoryLearningFolder } from "./in-memory-learning-folder";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryLearningsPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

/** Who heard that what waits changed: the Space and the project, in order. */
export type InMemoryLearningsNotifications = LearningsNotifications & {
	told: [string, string][];
	/** From now on telling fails with this. */
	fail(error: unknown): void;
};

export function inMemoryLearningsNotifications(): InMemoryLearningsNotifications {
	let failure: { error: unknown } | null = null;
	const twin: InMemoryLearningsNotifications = {
		told: [],
		fail: (error) => {
			failure = { error };
		},
		async learningsChanged(spaceId, projectId) {
			twin.told.push([spaceId, projectId]);
			if (failure) throw failure.error;
		},
	};
	return twin;
}

/** The runs a look back reads, set by a test. */
export type InMemoryRunsToLearnFrom = RunsToLearnFrom & {
	runs: Map<string, EndedRun>;
	/** What `listRuns` gives, newest first. */
	recent: RecentRun[];
	/** The transcripts, by `<runId>:<stepId>`. */
	transcripts: Map<string, TranscriptEntry[]>;
	/** Which runs this computer walks. */
	walked: Set<string>;
	/** Lands facts, as the engine does. */
	land(facts: { kind: string; spaceId: string; runId: string }[]): void;
};

export function inMemoryRunsToLearnFrom(): InMemoryRunsToLearnFrom {
	const listeners = new Set<
		(facts: readonly { kind: string; spaceId: string; runId: string }[]) => void
	>();
	const twin: InMemoryRunsToLearnFrom = {
		runs: new Map(),
		recent: [],
		transcripts: new Map(),
		walked: new Set(),
		land: (facts) => {
			for (const listener of listeners) listener(facts);
		},
		onLandedFacts(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		runHere: async (runId) =>
			twin.runs.has(runId) ? { walkedHere: twin.walked.has(runId) } : null,
		space: () => ({
			async getRun(runId) {
				const run = twin.runs.get(runId);
				if (!run) throw new Error(`No run ${runId}`);
				return run;
			},
			listRuns: async () => twin.recent,
			async stepTranscript(runId, stepId) {
				const entries = twin.transcripts.get(`${runId}:${stepId}`);
				if (!entries) throw new Error("No transcript");
				return { entries };
			},
		}),
	};
	return twin;
}

/** The Learner: what it was asked, and what it answers. */
export type InMemoryLearner = {
	learn: AskLearner;
	asked: Parameters<AskLearner>[0][];
	answer: string[];
};

export function inMemoryLearner(answer: string[] = []): InMemoryLearner {
	const twin: InMemoryLearner = {
		asked: [],
		answer,
		learn: async (input) => {
			twin.asked.push(input);
			return twin.answer;
		},
	};
	return twin;
}

/** Every port of knowledge/learnings in memory at once, over the real sync and search: where each use-case test starts. */
export function inMemoryLearningsPorts() {
	const sync = inMemorySync();
	const search = inMemorySearch(sync);
	return {
		access: inMemoryAccess(),
		folder: inMemoryLearningFolder(),
		sync,
		search,
		documents: sync.documents,
		archive: sync.archive,
		status: sync.status,
		holds: sync.reconciler,
		notifications: inMemoryLearningsNotifications(),
		closeNotes: search.closeNotes,
		runs: inMemoryRunsToLearnFrom(),
		learner: inMemoryLearner(),
		now: () => 1_700_000_000_000,
	};
}
