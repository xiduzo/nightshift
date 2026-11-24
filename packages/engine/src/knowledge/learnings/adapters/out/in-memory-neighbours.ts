import { inMemoryAccess } from "../../../../access/adapters/out/in-memory-access";
import type { TranscriptEntry } from "../../../../log";
import type {
	AskLearner,
	CloseNotes,
	ContentArchive,
	FolderHolds,
	LearningEntries,
	LearningsNotifications,
	RunsToLearnFrom,
	SpaceStatus,
} from "../../application/ports";
import type { EndedRun, RecentRun } from "../../domain/look-back";
import { inMemoryLearningFolder } from "./in-memory-learning-folder";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (`@filledBy` in `application/ports.ts`), and
 * `inMemoryLearningsPorts`, which gives a use-case test every port of
 * the slice at once. Test code: production code never imports this file.
 */

type Entry = { sha256: string; changedAt: number };

/** The knowledge documents of the projects, in memory. */
export type InMemoryLearningEntries = LearningEntries & {
	/** What each project's document lists, by path. */
	listed: Map<string, Map<string, Entry>>;
	/** Whether each project learns from its runs. Default: on. */
	learnsFromRuns: Map<string, boolean>;
	/** Lists a file in a project's document. */
	list(projectId: string, path: string, entry: Entry): void;
};

export function inMemoryLearningEntries(): InMemoryLearningEntries {
	const listed = new Map<string, Map<string, Entry>>();
	const learnsFromRuns = new Map<string, boolean>();
	const of = (projectId: string) => {
		const entries = listed.get(projectId) ?? new Map<string, Entry>();
		listed.set(projectId, entries);
		return entries;
	};
	return {
		listed,
		learnsFromRuns,
		list: (projectId, path, entry) => of(projectId).set(path, entry),
		async open(projectId) {
			return {
				entries: () => new Map(of(projectId)),
				learnsFromRunsOn: () => learnsFromRuns.get(projectId) ?? true,
				async setLearnsFromRuns(on) {
					learnsFromRuns.set(projectId, on);
				},
			};
		},
	};
}

/** The content by hash: what is here, and what only the Host has. */
export type InMemoryContentArchive = ContentArchive & {
	/** Content on this computer, by hash. */
	local: Map<string, Uint8Array>;
	/** Content only the Space's Host has, by hash. */
	host: Map<string, Uint8Array>;
	/** From now on the Host fails with this. */
	hostFails(error: unknown): void;
	/** Each hash asked of the Host, in order. */
	askedHost: string[];
};

export function inMemoryContentArchive(): InMemoryContentArchive {
	const local = new Map<string, Uint8Array>();
	const host = new Map<string, Uint8Array>();
	let failure: { error: unknown } | null = null;
	const twin: InMemoryContentArchive = {
		local,
		host,
		askedHost: [],
		hostFails: (error) => {
			failure = { error };
		},
		here: { read: async ({ sha256 }) => local.get(sha256) ?? null },
		async read({ sha256 }) {
			const here = local.get(sha256);
			if (here) return here;
			twin.askedHost.push(sha256);
			if (failure) throw failure.error;
			return host.get(sha256) ?? null;
		},
	};
	return twin;
}

/** The Spaces of the projects, and what the Host failures said. */
export type InMemorySpaceStatus = SpaceStatus & {
	spaces: Map<string, string>;
	heardFrom: { spaceId: string; error: unknown }[];
};

export function inMemorySpaceStatus(): InMemorySpaceStatus {
	const spaces = new Map<string, string>();
	const twin: InMemorySpaceStatus = {
		spaces,
		heardFrom: [],
		spaceOf: async (projectId) => spaces.get(projectId) ?? null,
		heard: (spaceId, error) => twin.heardFrom.push({ spaceId, error }),
	};
	return twin;
}

/** The holds of the folders: each start and each end, in order. */
export type InMemoryFolderHolds = FolderHolds & { log: string[] };

export function inMemoryFolderHolds(): InMemoryFolderHolds {
	const log: string[] = [];
	return {
		log,
		async startStep(projectId) {
			log.push(`hold ${projectId}`);
			return {
				done: async () => {
					log.push(`done ${projectId}`);
				},
			};
		},
	};
}

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

/** The close notes: what a test sets, and the notes each call compared. */
export type InMemoryCloseNotes = CloseNotes & {
	/** What `among` answers next. Null: nothing could be compared yet. */
	answer: Awaited<ReturnType<CloseNotes["among"]>>;
	/** The notes each call compared. */
	compared: Awaited<ReturnType<Parameters<CloseNotes["among"]>[1]["notes"]>>[];
	/** The `onPrepared` of the last call: a test calls it as the vectors get ready. */
	prepared: (() => void) | null;
};

export function inMemoryCloseNotes(): InMemoryCloseNotes {
	const twin: InMemoryCloseNotes = {
		answer: null,
		compared: [],
		prepared: null,
		async among(_projectId, read) {
			twin.compared.push(await read.notes());
			twin.prepared = read.onPrepared;
			return twin.answer;
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

/** Every port of knowledge/learnings in memory at once: where each use-case test starts. */

export function inMemoryLearningsPorts() {
	return {
		access: inMemoryAccess(),
		folder: inMemoryLearningFolder(),
		documents: inMemoryLearningEntries(),
		archive: inMemoryContentArchive(),
		status: inMemorySpaceStatus(),
		holds: inMemoryFolderHolds(),
		notifications: inMemoryLearningsNotifications(),
		closeNotes: inMemoryCloseNotes(),
		runs: inMemoryRunsToLearnFrom(),
		learner: inMemoryLearner(),
		now: () => 1_700_000_000_000,
	};
}
