import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type KnowledgeUse, useHit } from "@nightshift/agents/knowledge";
import { QUESTION_SET_FILE } from "@nightshift/flows";
import { createRunLog, knowledgeUseEvent } from "../log";
import {
	type KnowledgeFolders,
	type KnowledgeReader,
	wireFiles,
} from "./files";
import type {
	Knowledge,
	KnowledgeDeps,
	KnowledgeHosts,
} from "./knowledge-door";
import {
	type FollowRunsDeps,
	type Learnings,
	type ProjectLearning,
	type RunLearnings,
	wireLearnings,
} from "./learnings";
import { wireMap } from "./map";
import { type PageReaders, wireReaders } from "./readers";
import { type KnowledgeQuestion, parseQuestions, wireReview } from "./review";
import {
	isMarkdown,
	type KnowledgeSearch,
	markdownHeadings,
	wireSearch,
} from "./search";
import { wireSources } from "./sources";
import { createStepKnowledge } from "./step-knowledge";
import {
	type KnowledgeDocuments,
	type KnowledgeReconciler,
	type KnowledgeSync,
	wireSync,
} from "./sync";

/**
 * What every block of `createKnowledge` reads: the parts it builds first,
 * in the order it builds them, and the helpers more than one block uses.
 */
type KnowledgeParts = {
	deps: KnowledgeDeps;
	folders: KnowledgeFolders;
	documents: KnowledgeDocuments;
	search: KnowledgeSearch;
	learnings: Learnings;
	sync: KnowledgeSync;
	reconciler: KnowledgeReconciler;
	reader: KnowledgeReader;
	readers: PageReaders;
	steps: ReturnType<typeof createStepKnowledge>;
	/** What `connect` sets, and what `close` stops. */
	late: { hosts: KnowledgeHosts | null; stopTimers(): void };
	/** Logs an agent's use. A failed write does not fail the answer. */
	logged(projectId: string, use: KnowledgeUse): Promise<void>;
	/** The question set, as the Space has it: the folder is brought in step first, as for a step. */
	questionSet(projectId: string): Promise<KnowledgeQuestion[]>;
	/** The learnings that wait in these projects, newest first, each with its project. */
	projectLearnings(projectIds: readonly string[]): Promise<ProjectLearning[]>;
};

/**
 * The one door to a project's knowledge on this Device. It builds the
 * parts, then takes the members of `Knowledge` from one block each: the
 * sync and the files, the search, the page readers, the learnings, the
 * sources with the Map and the review, and the steps.
 */
export function createKnowledge(deps: KnowledgeDeps): Knowledge {
	const { db, archive, device } = deps;
	/** The devices runtime, made after this: until then content stays here. */
	const late: KnowledgeParts["late"] = { hosts: null, stopTimers: () => {} };
	// The folders are made by `wireFiles` below: the sync reads them only when it runs.
	const sync = wireSync({
		db,
		documents: deps.documents,
		folders: {
			folder: (projectId) => folders.folder(projectId),
			known: () => folders.known(),
			scan: (projectId) => folders.scan(projectId),
		},
		archive,
		locks: deps.folderLocks,
		deviceId: device.id,
		hosts: {
			inStep: async (spaceId, names, options) =>
				late.hosts?.inStep(spaceId, names, options),
		},
		listener: { reconciled: (change) => learnings.reconciled(change) },
		...(deps.usage ? { usage: deps.usage } : {}),
	});
	const { documents, status, reconciler } = sync;
	const search = wireSearch({
		dataDir: deps.dataDir,
		folders: { scan: (projectId) => folders.scan(projectId) },
		...(deps.meaning ? { meaning: deps.meaning } : {}),
		meaningOn: async (projectId) =>
			(await documents.open(projectId)).meaningOn(),
	});
	const learnings = wireLearnings({
		folders: { folder: (projectId) => folders.folder(projectId) },
		documents,
		archive,
		status,
		startStep: (projectId) => reconciler.startStep(projectId),
		notifications: deps.notifications,
		closeNotes: search.closeNotes,
	});
	const files = wireFiles({
		dataDir: deps.dataDir,
		deviceId: device.id,
		...(deps.pageWaitMs !== undefined ? { pageWaitMs: deps.pageWaitMs } : {}),
		documents,
		status,
		archive,
		notes: learnings,
		sync: reconciler,
		markdown: { isMarkdown, headings: markdownHeadings },
	});
	const { folders, reader } = files;
	const readers = wireReaders({
		dataDir: deps.dataDir,
		settings: {
			setting: async (projectId) => (await documents.open(projectId)).reader(),
			async choose(projectId, setting) {
				const document = await documents.open(projectId);
				await document.setReader(setting);
				return document.reader();
			},
		},
		rules: () => ({ privateNetwork: deps.privateNetwork?.() ?? true }),
		...(deps.secret ? { secret: deps.secret } : {}),
	});
	const steps = createStepKnowledge({
		folders,
		files,
		reconciler,
		reader,
		search,
		learnings,
		readers,
	});
	/** Facts of a project with no run: an agent's use through the MCP server. No landing feed reads them. */
	const log = createRunLog(db, { walkerId: device.id, dataDir: deps.dataDir });

	const parts: KnowledgeParts = {
		deps,
		folders,
		documents,
		search,
		learnings,
		sync,
		reconciler,
		reader,
		readers,
		steps,
		late,
		async logged(projectId, use) {
			await log
				.append(knowledgeUseEvent(projectId, use, "mcp"))
				.catch((error) => {
					console.warn("A use of the knowledge was not logged:", error);
				});
		},
		async questionSet(projectId) {
			const hold = await reconciler.startStep(projectId);
			try {
				return parseQuestions(await readQuestions(folders, projectId));
			} finally {
				await hold.done();
			}
		},
		async projectLearnings(projectIds) {
			const lists = await Promise.all(
				projectIds.map(async (projectId) =>
					(await learnings.waiting(projectId)).map((learning) => ({
						...learning,
						projectId,
					})),
				),
			);
			return lists
				.flat()
				.sort(
					(a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id),
				);
		},
	};
	return {
		...syncMembers(parts),
		...searchMembers(parts),
		...readerMembers(parts),
		...learningMembers(parts),
		...reviewMembers(parts),
		...stepMembers(parts),
	};
}

/** The question set's file in this computer's folder, or null. */
function readQuestions(
	folders: KnowledgeParts["folders"],
	projectId: string,
): Promise<string | null> {
	const file = join(folders.folder(projectId), ...QUESTION_SET_FILE.split("/"));
	return readFile(file, "utf8").catch(() => null);
}

/** The sync with the Space and the files: the timers, the listing, a read and a move. */
function syncMembers(
	parts: KnowledgeParts,
): Pick<Knowledge, "connect" | "listing" | "read" | "moved"> {
	const { deps, sync, reconciler, reader, search, late } = parts;
	return {
		connect(runtime) {
			late.hosts = runtime;
			late.stopTimers();
			late.stopTimers = sync.startTimers({
				...(runtime.keeps ? { keeps: runtime.keeps.bind(runtime) } : {}),
				...(deps.timers ? { times: deps.timers } : {}),
			});
		},
		listing: reader.listing,
		async read(projectId, path, { maxBytes, from, agent }) {
			const file = await reader.read(projectId, path, maxBytes, from);
			if (agent) {
				await parts.logged(projectId, {
					kind: "read",
					path: file?.path ?? path.trim(),
					found: file !== null,
					...(from ? { from } : {}),
				});
			}
			return file;
		},
		async moved(move) {
			for (const [projectId, to] of Object.entries(move.projects)) {
				await reconciler.move({ from: { spaceId: move.from, projectId }, to });
				if (to.projectId === projectId) continue;
				// The old id's folder is gone: its rows leave the index.
				await search.refresh(projectId).catch(() => {});
				search.refresh(to.projectId).catch(() => {});
			}
			for (const to of Object.values(move.projects)) {
				reconciler.reconcile(to.projectId).catch(() => {});
			}
		},
	};
}

/** The search: by words and by meaning, and the question set against it. */
function searchMembers(
	parts: KnowledgeParts,
): Pick<Knowledge, "search" | "meaning" | "setMeaning" | "evaluate"> {
	const { documents, search } = parts;
	return {
		async search(projectId, query, options = {}) {
			const { limit, agent } = options;
			const hits = await search.search(
				projectId,
				query,
				limit !== undefined ? { limit } : {},
			);
			if (agent) {
				await parts.logged(projectId, {
					kind: "search",
					query: query.trim(),
					hits: hits.map(useHit),
				});
			}
			return hits;
		},
		meaning: search.meaning,
		async setMeaning(projectId, on) {
			await (await documents.open(projectId)).setMeaning(on);
			return search.meaning(projectId);
		},
		async evaluate(projectId) {
			return search.evaluate(projectId, await parts.questionSet(projectId));
		},
	};
}

/** The page readers (ADR 39): the quick look at links, and the reader a project uses. */
function readerMembers(
	parts: KnowledgeParts,
): Pick<Knowledge, "look" | "setReader"> {
	const { readers } = parts;
	return { look: readers.look, setReader: readers.choose };
}

/** The learnings: what waits for a person, and what a person or a run adds. */
function learningMembers(
	parts: KnowledgeParts,
): Pick<
	Knowledge,
	| "learnings"
	| "settleLearning"
	| "settleNote"
	| "tellLearning"
	| "proposeFromRun"
	| "knownLearnings"
	| "learnsFromRuns"
	| "setLearnsFromRuns"
	| "followRuns"
> {
	const { learnings } = parts;
	return {
		learnings: parts.projectLearnings,
		settleLearning: learnings.settle,
		settleNote: learnings.settleNote,
		tellLearning: learnings.tell,
		proposeFromRun: learnings.proposeFromRun,
		knownLearnings: learnings.known,
		learnsFromRuns: learnings.learnsFromRuns,
		setLearnsFromRuns: learnings.setLearnsFromRuns,
		followRuns: learnings.followRuns,
	};
}

/**
 * Learnings from runs that ended (ADR 37), over the learnings of a
 * Knowledge: what the daemon calls until it calls `followRuns` itself.
 */
export function createRunLearnings(
	deps: FollowRunsDeps & { knowledge: Pick<Knowledge, "followRuns"> },
): RunLearnings {
	const { knowledge, ...follow } = deps;
	return knowledge.followRuns(follow);
}

/** The sources, the questions, the Map, how agents use the files, and the review of all of it. */
function reviewMembers(
	parts: KnowledgeParts,
): Pick<
	Knowledge,
	| "review"
	| "questions"
	| "markQuestion"
	| "map"
	| "markNotTopic"
	| "use"
	| "sources"
> {
	const { deps, folders, documents, search, learnings, reconciler, reader } =
		parts;
	const holds = {
		startStep: (projectId: string) => reconciler.startStep(projectId),
	};
	const sources = wireSources({
		files: { listing: reader.listing, removeFolder: reconciler.removeFolder },
		readers: { ready: parts.readers.ready },
		device: deps.device,
	});
	const review = wireReview({
		db: deps.db,
		folders,
		holds,
		files: { files: (projectId) => reader.files(projectId) },
		questionSet: { questionSet: parts.questionSet },
		syncs: {
			syncs: (space, projectId) => sources.sourcesIn(space).syncs(projectId),
		},
		learnings: { learnings: parts.projectLearnings },
	});
	const map = wireMap({
		folders,
		entries: documents,
		index: search,
		learnings,
		asked: { asked: review.asked },
		holds,
	});
	return {
		review: review.review,
		questions: review.questions,
		markQuestion: review.markQuestion,
		map: map.map,
		markNotTopic: map.markNotTopic,
		use: review.use,
		sources: sources.sourcesIn,
	};
}

/** The steps: what a Command step and an Agent session get, and the end of this Knowledge. */
function stepMembers(
	parts: KnowledgeParts,
): Pick<Knowledge, "forCommand" | "forSession" | "close"> {
	const { steps, search, readers, late } = parts;
	return {
		forCommand: steps.forCommand,
		forSession: steps.forSession,
		close() {
			late.stopTimers();
			search.close();
			readers.close().catch(() => {});
		},
	};
}
