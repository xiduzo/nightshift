import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type KnowledgeReadFrom,
	type KnowledgeUse,
	useHit,
} from "@nightshift/agents/tools";
import type { Database } from "@nightshift/db";
import { NOT_TOPICS_FILE, QUESTION_SET_FILE } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { type SpaceArchive, writeWhole } from "../archive";
import type { SyncedDocuments } from "../documents";
import { createRunLog } from "../log";
import type { UsageNotes } from "../usage";
import { collectContent } from "./collect";
import { evaluateKnowledge, type KnowledgeEvaluation } from "./evaluate";
import { createKnowledgeFolders, type KnowledgeText } from "./folder";
import type { KnowledgeFolderLocks } from "./folder-locks";
import { isReadable } from "./folder-snapshot";
import { createKnowledgeDocuments } from "./knowledge-document";
import {
	createKnowledgeReader,
	type KnowledgeListing,
} from "./knowledge-reader";
import {
	createLearnings,
	type LearningsNotifications,
	type ProjectLearning,
} from "./learnings";
import { createMapMemo, type KnowledgeMap, knowledgeMapOf } from "./map";
import type { KnowledgeMeaning } from "./meaning";
import { formatNotTopics, markNotTopic, parseNotTopics } from "./not-topics";
import {
	formatQuestions,
	type KnowledgeQuestion,
	markQuestion,
	parseQuestions,
	questionKey,
} from "./questions";
import { createKnowledgeReconciler } from "./reconcile";
import { type ReviewTask, reviewTasks } from "./review";
import {
	createKnowledgeSearch,
	type KnowledgeHit,
	type KnowledgeMeaningStatus,
} from "./search";
import {
	type KnowledgeSources,
	knowledgeSources,
	type SourceRun,
	type SourcesSpace,
} from "./sources";
import { createSpaceHostStatus } from "./space-host-status";
import {
	type CommandKnowledge,
	createStepKnowledge,
	type KnowledgeRequest,
	type SessionKnowledge,
	type SessionStep,
} from "./step-knowledge";
import {
	type AskedQuestion,
	askedQuestions,
	type KnowledgeUseReport,
	knowledgeFileUse,
	knowledgeUseEvent,
} from "./use";

/** The Hosts of the Spaces, once the devices runtime is up. */
type KnowledgeHosts = {
	/** Waits until this Replica's documents of a Space are in step with its Host's. */
	inStep(
		spaceId: string,
		names: readonly string[],
		options: { timeoutMs: number },
	): Promise<unknown>;
	/**
	 * Whether this Replica keeps the Space: it is the Space's Host, or the
	 * Space has none. Without it, nothing is collected.
	 */
	keeps?(spaceId: string): Promise<boolean>;
};

/** A question agents asked, and the files a person marked as its answer. */
type AskedQuestionWithAnswers = AskedQuestion & {
	/** Null: it is not in the question set. */
	answers: string[] | null;
};

/** The questions agents asked a project's knowledge, and its question set. */
type KnowledgeQuestions = {
	asked: AskedQuestionWithAnswers[];
	set: KnowledgeQuestion[];
};

/**
 * A project's knowledge on this Device, as one module: its folder, the
 * reconcile with the Space (ADR 4), the index and the search, the
 * learnings, the question set, the Map, how agents use it, and the order
 * between them. The one door to all of it: a step's Device, the API, the
 * daemon and the tests cross this interface and nothing else.
 *
 * A step holds the folder between `forCommand` or `forSession` and its
 * `done`: the reconcile before it brings the Space's changes in, the one
 * after it publishes what the step wrote, and nothing else reconciles the
 * folder in between. The page and the timers skip a project a step holds,
 * and removing a source's files refuses it. A reconcile that fails leaves
 * the folder as it is: the step goes on.
 *
 * One `Knowledge` per daemon. `connect` is its one late binding, because
 * the devices runtime is made after the Device that takes this. `close`
 * ends it. On a `bun --hot` reload the daemon closes the one before it and
 * makes a new one: only what is on disk is kept (`daemon.ts`).
 */
export type Knowledge = {
	/**
	 * The Hosts of the Spaces, from the devices runtime: from now on a
	 * reconcile waits for the document to be in step with its Host's, and
	 * this Device keeps its folders in step on its own: every folder a
	 * moment after this, each minute the ones whose content waits for its
	 * Host, and once a day it removes the content of the Spaces it keeps
	 * that no document lists any more. Nothing of that before this call.
	 */
	connect(hosts: KnowledgeHosts): void;
	/** A Command step starts: the folder, made for it, in `NS_KNOWLEDGE`. */
	forCommand(projectId: string): Promise<CommandKnowledge>;
	/**
	 * An Agent session starts: the folder in `NS_KNOWLEDGE`, and when it
	 * has files or the node asks for it, the folder to read with a fresh
	 * index, and the session brief with, for a step of a run (`runId`), the
	 * learnings. The index catches up with the folder from now on, not at
	 * the first search. It gets nothing when the request asks for nothing.
	 *
	 * With `knowledgeOnly`: a view of those folders instead (`view.ts`), even
	 * when it is empty. `NS_KNOWLEDGE`, the line and the folder to read
	 * are the view's, the tools find nothing else, and the session never
	 * gets the folder's path. Its learnings still go to the folder's
	 * `learnings/proposed/`. The view goes when the step ends. A view that
	 * cannot be made gives no knowledge, never the whole folder.
	 */
	forSession(
		request: KnowledgeRequest,
		step?: SessionStep,
	): Promise<SessionKnowledge>;
	/**
	 * The files as the Space lists them, after a reconcile of this folder
	 * for a while, how many notes wait, and what the page says about the
	 * Space. While a step holds the folder, the document as it is.
	 */
	listing(projectId: string): Promise<KnowledgeListing>;
	/**
	 * The files that best match the words, best first, each at its best
	 * section: by keyword, and by meaning when this computer can.
	 * `agent`: an agent asks through the nightshift MCP server, so the use
	 * is logged for the Knowledge page. A failed write of it does not fail
	 * the answer. A person's search on the page is not logged.
	 */
	search(
		projectId: string,
		query: string,
		options?: { limit?: number; agent?: boolean },
	): Promise<KnowledgeHit[]>;
	/**
	 * One file by its path, at most `maxBytes` of its text, from `from`
	 * when given: this computer's copy, else its content by hash from the
	 * Space. Null: no such file. `agent`: as for `search`.
	 */
	read(
		projectId: string,
		path: string,
		options: { maxBytes: number; from?: KnowledgeReadFrom; agent?: boolean },
	): Promise<KnowledgeText | null>;
	/**
	 * The learnings agents proposed that wait for a person in these
	 * projects, newest first. Each is one step's proposals.
	 */
	learnings(projectIds: readonly string[]): Promise<ProjectLearning[]>;
	/**
	 * What waits for a person on the Knowledge page, in the order a person
	 * meets it: sources that need a look, learnings, questions that found
	 * nothing and files no run used. In `space` as the person who asks sees it.
	 * It holds no folder. Only a learning whose content is not here yet asks
	 * the Host.
	 */
	review<Run extends SourceRun>(
		projectId: string,
		space: SourcesSpace<Run>,
	): Promise<ReviewTask[]>;
	/**
	 * Keeps or deletes one step's proposals, as the review of learnings
	 * (`kit:knowledge/review-learnings`) does: keep adds them to
	 * `learnings/accepted/`, where agents read them, and both take them
	 * out of `learnings/proposed/`. It holds the folder as a step does,
	 * so the change goes to the Space when it ends, and the open screens
	 * hear of it. Refuses a proposal that no longer waits, and one whose
	 * content cannot be fetched now.
	 */
	settleLearning(
		projectId: string,
		id: string,
		decision: "keep" | "delete",
	): Promise<void>;
	/**
	 * The questions agents asked, newest first (at most `limit`), with the
	 * files a person marked as the answer, and the question set as the
	 * Space has it: the folder is brought in step first, as for a step.
	 */
	questions(
		projectId: string,
		options?: { limit?: number },
	): Promise<KnowledgeQuestions>;
	/**
	 * Marks the files that answer a question an agent asked, or with no
	 * files (or none an agent reads) takes it out of the set. The set goes
	 * to the Space as a step's changes do. Returns the set.
	 */
	markQuestion(
		projectId: string,
		mark: { query: string; answers: readonly string[]; by: string | null },
	): Promise<KnowledgeQuestion[]>;
	/**
	 * The Map: the files, the topics they share, the files close in meaning,
	 * the questions that found them and the learnings that name their
	 * topics. It draws what this computer's search index holds: drawing never
	 * asks the Host, nor any model. A file the index does not have stays on
	 * the Map, alone.
	 */
	map(projectId: string): Promise<KnowledgeMap>;
	/**
	 * Marks a word as not a topic, so no Map of the Space shows it, or puts
	 * it back. The list goes to the Space as a step's changes do. Returns the
	 * list.
	 */
	markNotTopic(
		projectId: string,
		mark: { word: string; notTopic: boolean; by: string | null },
	): Promise<string[]>;
	/** How often agents found and read each file, when a run last used it, and which files no run used lately. */
	use(projectId: string): Promise<KnowledgeUseReport>;
	/** The question set against each way to search on this computer. */
	evaluate(projectId: string): Promise<KnowledgeEvaluation>;
	/**
	 * Whether search by meaning works for the project on this computer.
	 * Starts the preparation of its vectors when they are behind.
	 */
	meaning(projectId: string): Promise<KnowledgeMeaningStatus>;
	/**
	 * Turns search by meaning on or off for the project, for every Device
	 * of its Space. Returns how it stands now.
	 */
	setMeaning(projectId: string, on: boolean): Promise<KnowledgeMeaningStatus>;
	/**
	 * The project's sources, in `space` as the person who asks sees it.
	 * What the person may do comes with each change (`SourceRights`).
	 */
	sources<Run extends SourceRun>(
		space: SourcesSpace<Run>,
	): KnowledgeSources<Run>;
	/**
	 * Projects moved to other Spaces (`Engine.moveProjects`): each one's
	 * knowledge follows it, to its new id when it has one: the document,
	 * the folder, the content and the search index. The next reconcile
	 * copies the content to the new Space's Host.
	 */
	moved(move: {
		from: string;
		projects: Readonly<Record<string, { spaceId: string; projectId: string }>>;
	}): Promise<void>;
	/**
	 * Ends this Knowledge: the timers stop, the index file closes, and no
	 * vectors are prepared any more. A session that outlives it (a reload,
	 * under a placed step) still searches: the index opens again for it.
	 */
	close(): void;
};

/** When this Device keeps its folders in step on its own, from `connect` on. */
const TIMERS = {
	/** Every folder, once the Links had a moment to come up: the import on upgrade (ADR 4, decision 10), and what changed while the daemon was down. */
	firstReconcileMs: 15_000,
	/** The folders whose content still waits for its Host. */
	retryMs: 60_000,
	/** The content of the Spaces this Device keeps that no document lists any more. */
	firstCollectMs: 60 * 60_000,
	collectMs: 24 * 60 * 60_000,
	/** The size of each knowledge document, for the anonymous usage. */
	firstMeasureMs: 60 * 60_000,
	measureMs: 24 * 60 * 60_000,
};

export type KnowledgeDeps = {
	db: Database;
	/** Where this computer keeps its data: the folders and the index. */
	dataDir: string;
	/** This Replica's synced documents: the knowledge documents are some of them. */
	documents: SyncedDocuments;
	/** The content by hash: here, and at the Spaces' Hosts once the devices runtime connects it. */
	archive: SpaceArchive;
	/** The turns and the holds of each folder. One set per process: they must outlive this Knowledge across a reload. */
	folderLocks: KnowledgeFolderLocks;
	/** This computer: it signs what it writes, and a source that reads a folder here syncs here. */
	device: { id: string; name: string };
	/**
	 * The embedding model for search by meaning, or what gives the one to
	 * use now. Without it, or when it gives null, search finds by words only.
	 */
	meaning?: KnowledgeMeaning | (() => KnowledgeMeaning | null);
	/** How long a page read waits for its reconcile. Default 2 s. */
	pageWaitMs?: number;
	/** Where the size of each knowledge document goes, once a day. */
	usage?: UsageNotes;
	/** Who tells the open screens that the learnings that wait changed, on any path. */
	notifications: LearningsNotifications;
	/** Other times for `TIMERS`. */
	timers?: Partial<typeof TIMERS>;
};

/**
 * What the Map reads of the index, at most, at each draw it must do: it runs on
 * the daemon's one thread. See `docs/knowledge.md`, "The Map", for what this
 * costs at the limits.
 */
const MAP_LIMITS = {
	maxBytes: 6_000_000,
	maxBytesPerFile: 60_000,
	maxVectors: 4_000,
};

export function createKnowledge(deps: KnowledgeDeps): Knowledge {
	const { db, archive, device } = deps;
	const folders = createKnowledgeFolders(deps.dataDir);
	const documents = createKnowledgeDocuments({
		db,
		documents: deps.documents,
	});
	const search = createKnowledgeSearch(deps.dataDir, {
		...(deps.meaning ? { meaning: deps.meaning } : {}),
		meaningOn: async (projectId) =>
			(await documents.open(projectId)).meaningOn(),
	});
	/** The devices runtime, made after this: until then content stays here. */
	let hosts: KnowledgeHosts | null = null;
	const status = createSpaceHostStatus(db);
	const learnings = createLearnings({
		folders,
		documents,
		archive,
		status,
		startStep: (projectId) => reconciler.startStep(projectId),
		notifications: deps.notifications,
		closeNotes: search.closeNotes,
	});
	const reconciler = createKnowledgeReconciler({
		folders,
		documents,
		archive,
		status,
		locks: deps.folderLocks,
		deviceId: device.id,
		inStep: async (spaceId, names, options) =>
			hosts?.inStep(spaceId, names, options),
		reconciled: learnings.reconciled,
	});
	const reader = createKnowledgeReader({
		folders,
		documents,
		archive,
		learnings,
		status,
		deviceId: device.id,
		reconcileUnlessHeld: reconciler.reconcileUnlessHeld,
		...(deps.pageWaitMs !== undefined ? { pageWaitMs: deps.pageWaitMs } : {}),
	});
	const steps = createStepKnowledge({
		folders,
		reconciler,
		reader,
		search,
		learnings,
	});
	const mapMemo = createMapMemo();
	/** Facts of a project with no run: an agent's use through the MCP server. No landing feed reads them. */
	const log = createRunLog(db, { walkerId: device.id });

	/** Logs an agent's use; a failed write does not fail the answer. */
	async function logged(projectId: string, use: KnowledgeUse): Promise<void> {
		await log
			.append(knowledgeUseEvent(projectId, use, "mcp"))
			.catch((error) => {
				console.warn("A use of the knowledge was not logged:", error);
			});
	}

	/** Stops the timers `connect` started. */
	let stopTimers = () => {};
	function startTimers(): () => void {
		const times = { ...TIMERS, ...deps.timers };
		const first = setTimeout(() => {
			reconciler.reconcileAll().catch((error) => {
				console.warn("The knowledge was not brought in step:", error);
			});
		}, times.firstReconcileMs);
		const retry = setInterval(() => {
			reconciler.retryPending().catch(() => {});
		}, times.retryMs);
		const collectNow = () => {
			const keeps = hosts?.keeps?.bind(hosts);
			if (!keeps) return;
			collectContent({ db, documents, archive, keeps }).catch((error) => {
				console.warn("The old knowledge content was not removed:", error);
			});
		};
		const firstCollect = setTimeout(collectNow, times.firstCollectMs);
		const collect = setInterval(collectNow, times.collectMs);
		const measureNow = () => {
			documents
				.sizes()
				.then((sizes) => {
					for (const size of sizes) {
						deps.usage?.note({ kind: "knowledge-document-measured", ...size });
					}
				})
				.catch((error) => {
					console.warn("The knowledge documents were not measured:", error);
				});
		};
		const firstMeasure = setTimeout(measureNow, times.firstMeasureMs);
		const measure = setInterval(measureNow, times.measureMs);
		for (const timer of [
			first,
			retry,
			firstCollect,
			collect,
			firstMeasure,
			measure,
		]) {
			timer.unref();
		}
		return () => {
			clearTimeout(first);
			clearInterval(retry);
			clearTimeout(firstCollect);
			clearInterval(collect);
			clearTimeout(firstMeasure);
			clearInterval(measure);
		};
	}

	/** The question set's file in this computer's folder, or null. */
	function readQuestions(projectId: string): Promise<string | null> {
		const file = join(
			folders.folder(projectId),
			...QUESTION_SET_FILE.split("/"),
		);
		return readFile(file, "utf8").catch(() => null);
	}

	/** The question set, as the Space has it: the folder is brought in step first, as for a step. */
	async function questionSet(projectId: string): Promise<KnowledgeQuestion[]> {
		const hold = await reconciler.startStep(projectId);
		try {
			return parseQuestions(await readQuestions(projectId));
		} finally {
			await hold.done();
		}
	}

	/** The file of the words that are not topics, in this computer's folder. */
	function notTopicsFile(projectId: string): string {
		return join(folders.folder(projectId), ...NOT_TOPICS_FILE.split("/"));
	}

	/** The words people marked, as far as this computer's folder has them. */
	async function notTopicsHere(projectId: string) {
		return parseNotTopics(
			await readFile(notTopicsFile(projectId), "utf8").catch(() => null),
		);
	}

	/** What `sources` and `review` read: the sources in `space`, over this Device's files. */
	function sourcesIn<Run extends SourceRun>(space: SourcesSpace<Run>) {
		return knowledgeSources({
			space,
			files: { listing: reader.listing, removeFolder: reconciler.removeFolder },
			device,
		});
	}

	/** The learnings that wait in these projects, newest first, each with its project. */
	async function projectLearnings(
		projectIds: readonly string[],
	): Promise<ProjectLearning[]> {
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
			.sort((a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id));
	}

	/** How agents used the project's knowledge, and which of the files the document lists no run used lately. */
	async function use(projectId: string) {
		const files = await reader.files(projectId);
		return { files, use: await knowledgeFileUse(db, projectId, files) };
	}

	return {
		connect(runtime) {
			hosts = runtime;
			stopTimers();
			stopTimers = startTimers();
		},
		forCommand: steps.forCommand,
		forSession: steps.forSession,
		listing: reader.listing,
		async search(projectId, query, options = {}) {
			const { limit, agent } = options;
			const hits = await search.search(
				projectId,
				query,
				limit !== undefined ? { limit } : {},
			);
			if (agent) {
				await logged(projectId, {
					kind: "search",
					query: query.trim(),
					hits: hits.map(useHit),
				});
			}
			return hits;
		},
		async read(projectId, path, { maxBytes, from, agent }) {
			const file = await reader.read(projectId, path, maxBytes, from);
			if (agent) {
				await logged(projectId, {
					kind: "read",
					path: file?.path ?? path.trim(),
					found: file !== null,
					...(from ? { from } : {}),
				});
			}
			return file;
		},
		learnings: projectLearnings,
		async review(projectId, space) {
			const [syncs, waiting, asked, used] = await Promise.all([
				sourcesIn(space).syncs(projectId),
				projectLearnings([projectId]),
				askedQuestions(db, projectId),
				use(projectId),
			]);
			const unused = new Set(used.use.unused);
			return reviewTasks({
				syncs,
				learnings: waiting,
				asked,
				unused: used.files.filter((file) => unused.has(file.path)),
			});
		},
		settleLearning: learnings.settle,
		async questions(projectId, options = {}) {
			const [asked, set] = await Promise.all([
				askedQuestions(db, projectId, options),
				questionSet(projectId),
			]);
			const answers = new Map(
				set.map((question) => [questionKey(question.query), question.answers]),
			);
			return {
				asked: asked.map((question) => ({
					...question,
					answers: answers.get(questionKey(question.query)) ?? null,
				})),
				set,
			};
		},
		async markQuestion(projectId, mark) {
			const hold = await reconciler.startStep(projectId);
			try {
				const next = markQuestion(
					parseQuestions(await readQuestions(projectId)),
					{
						...mark,
						// Only a file an agent reads can answer.
						answers: mark.answers.filter(isReadable),
						at: now(),
					},
				);
				const file = join(
					await folders.ensure(projectId),
					...QUESTION_SET_FILE.split("/"),
				);
				await writeWhole(file, formatQuestions(next));
				return next;
			} finally {
				await hold.done();
			}
		},
		async map(projectId) {
			const [listed, stamp, asked, waiting, marked] = await Promise.all([
				documents.open(projectId).then((document) => document.entries()),
				search.mapStamp(projectId),
				askedQuestions(db, projectId),
				learnings.waiting(projectId, { onlyHere: true }),
				notTopicsHere(projectId),
			]);
			const spaceFiles = [...listed.keys()].filter(isReadable);
			const notTopics = marked.map(({ word }) => word);
			return mapMemo(
				projectId,
				[
					stamp,
					spaceFiles,
					asked.map(({ query, hits }) => [query, hits.map((hit) => hit.path)]),
					waiting.map(({ id, notes }) => [id, notes]),
					notTopics,
				],
				async () => {
					const index = await search.forMap(projectId, MAP_LIMITS);
					return knowledgeMapOf({
						// What the Space lists, and what this folder has but did not publish yet.
						files: [...spaceFiles, ...index.files],
						read: index.read,
						filesLeftOut: index.filesLeftOut,
						vectors: index.vectors,
						closeAt: index.closeAt,
						asked,
						learnings: waiting,
						notTopics,
					});
				},
			);
		},
		async markNotTopic(projectId, mark) {
			const hold = await reconciler.startStep(projectId);
			try {
				const next = markNotTopic(await notTopicsHere(projectId), {
					...mark,
					at: now(),
				});
				await folders.ensure(projectId);
				await writeWhole(notTopicsFile(projectId), formatNotTopics(next));
				return next.map(({ word }) => word);
			} finally {
				await hold.done();
			}
		},
		use: async (projectId) => (await use(projectId)).use,
		async evaluate(projectId) {
			return evaluateKnowledge(search, projectId, await questionSet(projectId));
		},
		meaning: search.meaning,
		async setMeaning(projectId, on) {
			await (await documents.open(projectId)).setMeaning(on);
			return search.meaning(projectId);
		},
		sources: sourcesIn,
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
		close() {
			stopTimers();
			search.close();
		},
	};
}
