import {
	type KnowledgeReadFrom,
	type KnowledgeUse,
	useHit,
} from "@nightshift/agents/knowledge";
import type { Database } from "@nightshift/db";
import type { PageReaderSetting } from "@nightshift/flows";
import type { Access } from "../access";
import type { SpaceArchive } from "../archive";
import type {
	Actor,
	CommandKnowledge,
	KnowledgeRequest,
	SessionKnowledge,
	SessionStep,
} from "../contract";
import type { SyncedDocuments } from "../documents";
import { createRunLog, knowledgeUseEvent } from "../log";
import type { UsageNotes } from "../usage";
import { type KnowledgeListing, type KnowledgeText, wireFiles } from "./files";
import {
	type FollowRunsDeps,
	type LearningsNotifications,
	type NotePerson,
	type ProjectLearning,
	type RunLearnings,
	type WaitingNote,
	wireLearnings,
} from "./learnings";
import { type KnowledgeMap, wireMap } from "./map";
import { type LinkLook, type ReaderSecret, wireReaders } from "./readers";
import type {
	KnowledgeQuestion,
	KnowledgeQuestions,
	KnowledgeUseReport,
	ReviewTask,
} from "./review";
import { wireReview } from "./review";
import {
	isMarkdown,
	type KnowledgeEvaluation,
	type KnowledgeHit,
	type KnowledgeMeaning,
	type KnowledgeMeaningStatus,
	markdownHeadings,
	setMeaning as setProjectMeaning,
	wireSearch,
} from "./search";
import {
	type KnowledgeSources,
	type SourceRun,
	type SourcesSpace,
	wireSources,
} from "./sources";
import { wireSteps } from "./steps";
import {
	type KnowledgeFolderLocks,
	type KnowledgeTimes,
	wireSync,
} from "./sync";

/** Wires knowledge: builds sub-verticals and hands each the parts it reads. */

/** The Hosts of the Spaces, once the devices runtime is up. */
export type KnowledgeHosts = {
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

/**
 * A project's knowledge on this Device: folder, reconcile, search, learnings,
 * Map, and how agents use it. One door for Device, API, daemon and tests.
 * A step holds the folder between `forCommand`/`forSession` and `done`.
 * One `Knowledge` per daemon; `connect` binds Hosts late; `close` ends it.
 */
export type Knowledge = {
	// The sync with the Space and the files.
	/** Binds Hosts: from now on reconciles wait for Host step and timers keep folders. */
	connect(hosts: KnowledgeHosts): void;
	/** Files as the Space lists them after a short reconcile, plus waiting notes. */
	listing(projectId: string): Promise<KnowledgeListing>;
	/** One file by path, at most `maxBytes` of text. Null when missing. */
	read(
		projectId: string,
		path: string,
		options: { maxBytes: number; from?: KnowledgeReadFrom; agent?: boolean },
	): Promise<KnowledgeText | null>;
	/** Projects moved to other Spaces: each one's knowledge follows it. */
	moved(move: {
		from: string;
		projects: Readonly<Record<string, { spaceId: string; projectId: string }>>;
	}): Promise<void>;

	// The search.
	/** Files that best match the words. `agent`: log the use for the Knowledge page. */
	search(
		projectId: string,
		query: string,
		options?: { limit?: number; agent?: boolean },
	): Promise<KnowledgeHit[]>;
	/** Whether search by meaning works; starts vector prep when behind. */
	meaning(projectId: string): Promise<KnowledgeMeaningStatus>;
	/** Turns search by meaning on or off for the project. Returns status. */
	setMeaning(
		actor: Actor,
		spaceId: string,
		projectId: string,
		on: boolean,
	): Promise<KnowledgeMeaningStatus>;
	/** The question set against each way to search on this computer. */
	evaluate(projectId: string): Promise<KnowledgeEvaluation>;

	// The page readers.
	/**
	 * The quick look at links a person tells, before anything is saved: what
	 * each one is, by the project's page reader (ADR 39), in their order.
	 */
	look(
		actor: Actor,
		spaceId: string,
		projectId: string,
		urls: readonly string[],
	): Promise<LinkLook[]>;
	/** Chooses the page reader of the project (ADR 39), for every Device of its Space. Returns it. */
	setReader(
		actor: Actor,
		spaceId: string,
		projectId: string,
		setting: PageReaderSetting,
	): Promise<PageReaderSetting>;

	// The learnings.
	/**
	 * The learnings agents proposed that wait for a person in these
	 * projects, newest first. Each is one step's proposed learnings.
	 */
	learnings(projectIds: readonly string[]): Promise<ProjectLearning[]>;
	/**
	 * Keeps or deletes one step's proposed learnings, as the review of learnings
	 * (`kit:knowledge/review-learnings`) does: keep adds them to
	 * `learnings/accepted/`, where agents read them, and both take them
	 * out of `learnings/proposed/`. It holds the folder as a step does,
	 * so the change goes to the Space when it ends, and the open screens
	 * hear of it. Refuses a proposed learning that no longer waits, and one whose
	 * content cannot be fetched now.
	 */
	settleLearning(
		actor: Actor,
		spaceId: string,
		projectId: string,
		id: string,
		decision: "keep" | "delete",
	): Promise<void>;
	/**
	 * Keeps or deletes one note of a learning that waits, not the whole
	 * step's: a kept note goes to `learnings/accepted/` with who kept it and
	 * when. The proposed file loses the note, and goes when none is left.
	 * It holds the folder as `settleLearning` does, and refuses what it
	 * refuses, and a note that no longer waits.
	 */
	settleNote(
		actor: Actor,
		spaceId: string,
		projectId: string,
		note: WaitingNote,
		decision: "keep" | "delete",
		by: NotePerson,
	): Promise<void>;
	/**
	 * Keeps a note a person wrote, with who told it and when, in their own
	 * file of `learnings/accepted/`: agents read it. With `replaces`, it
	 * takes the place of a note that waits. It holds the folder as
	 * `settleLearning` does.
	 */
	tellLearning(
		actor: Actor,
		spaceId: string,
		projectId: string,
		note: string,
		by: NotePerson,
		replaces?: WaitingNote,
	): Promise<void>;
	/**
	 * Proposes what Night Shift learned from a run that ended, in the run's
	 * own file in `learnings/proposed/`. It waits for a person as a step's
	 * learnings do. No note: nothing is written.
	 */
	proposeFromRun(
		projectId: string,
		runId: string,
		notes: readonly string[],
	): Promise<void>;
	/** The notes the project has on this computer, waiting and kept: what not to propose again. */
	knownLearnings(projectId: string): Promise<string[]>;
	/**
	 * Whether Night Shift proposes learnings from the runs of the project
	 * that ended (ADR 37): on unless a person turned it off.
	 */
	learnsFromRuns(projectId: string): Promise<boolean>;
	/** Turns the learnings from runs on or off for the project, for every Device of its Space. */
	setLearnsFromRuns(
		actor: Actor,
		spaceId: string,
		projectId: string,
		on: boolean,
	): Promise<void>;
	/**
	 * The look back at the runs this computer walks (ADR 37): when one ends
	 * with a signal, the Learner proposes what to learn, one look at a time.
	 */
	followRuns(deps: FollowRunsDeps): RunLearnings;

	// The sources, the Map and the review.
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
		actor: Actor,
		spaceId: string,
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
		actor: Actor,
		spaceId: string,
		projectId: string,
		mark: { word: string; notTopic: boolean; by: string | null },
	): Promise<string[]>;
	/** How often agents found and read each file, when a run last used it, and which files no run used lately. */
	use(projectId: string): Promise<KnowledgeUseReport>;
	/**
	 * The project's sources, in `space` as the person who asks sees it.
	 * What the person may do comes with each change (`SourceRights`).
	 */
	sources<Run extends SourceRun>(
		space: SourcesSpace<Run>,
	): KnowledgeSources<Run>;

	// The steps and the end.
	/**
	 * A Command step starts: the folder, made for it, in `NS_KNOWLEDGE`, and
	 * the project's page reader for it on this computer (ADR 39), with a key
	 * from the step's own secrets (`secret`).
	 */
	forCommand(
		projectId: string,
		step?: { secret?: ReaderSecret },
	): Promise<CommandKnowledge>;
	/**
	 * An Agent session starts: the folder in `NS_KNOWLEDGE`, and when it
	 * has files or the node asks for it, the folder to read with a fresh
	 * index, and the session brief with, for a step of a run (`runId`), the
	 * learnings. The index catches up with the folder from now on, not at
	 * the first search. It gets nothing when the request asks for nothing.
	 *
	 * With `knowledgeOnly`: a view of those folders instead (`openKnowledgeView`), even
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
	/** Ends this Knowledge: timers stop and the index closes. */
	close(): void;
};

export type KnowledgeDeps = {
	db: Database;
	/** Who may act in a Space (`access`). */
	access: Pick<Access, "openSpace">;
	/** Where this computer keeps its data: the folders and the index. */
	dataDir: string;
	/** This Replica's synced documents (knowledge among them). */
	documents: SyncedDocuments;
	/** Content by hash here, and at Hosts once the devices runtime connects. */
	archive: SpaceArchive;
	/** Turns and holds of each folder. One set per process across reloads. */
	folderLocks: KnowledgeFolderLocks;
	/** This computer: signs writes; a source that reads a folder here syncs here. */
	device: { id: string; name: string };
	/** Embedding model for search by meaning, or a getter. Without it, words only. */
	meaning?: KnowledgeMeaning | (() => KnowledgeMeaning | null);
	/** How long a page read waits for its reconcile. Default 2 s. */
	pageWaitMs?: number;
	/** Where the size of each knowledge document goes, once a day. */
	usage?: UsageNotes;
	/** Tells open screens that waiting learnings changed. */
	notifications: LearningsNotifications;
	/** Other times for the timers of `connect` (`TIMERS` of `sync`). */
	timers?: Partial<KnowledgeTimes>;
	/** Whether a page reader may reach the private network. Default: yes. */
	privateNetwork?: () => boolean;
	/** A secret of this computer outside a run: the key of a page reader for the quick look. */
	secret?: ReaderSecret;
};

export function wireKnowledge(deps: KnowledgeDeps): Knowledge {
	const { db, archive, device } = deps;
	/** The devices runtime, made after this: until then content stays here. */
	const late: { hosts: KnowledgeHosts | null; stopTimers(): void } = {
		hosts: null,
		stopTimers: () => {},
	};
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
		access: deps.access,
		folders: { folder: (projectId) => folders.folder(projectId) },
		documents,
		archive,
		status,
		holds: reconciler,
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
		access: deps.access,
		dataDir: deps.dataDir,
		documents,
		rules: () => ({ privateNetwork: deps.privateNetwork?.() ?? true }),
		...(deps.secret ? { secret: deps.secret } : {}),
	});
	const steps = wireSteps({
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
	/** Logs an agent's use. A failed write does not fail the answer. */
	async function logged(projectId: string, use: KnowledgeUse): Promise<void> {
		await log
			.append(knowledgeUseEvent(projectId, use, "mcp"))
			.catch((error) => {
				console.warn("A use of the knowledge was not logged:", error);
			});
	}
	const sources = wireSources({
		access: deps.access,
		files: reader,
		reconciler,
		readers,
		device: deps.device,
	});
	const review = wireReview({
		access: deps.access,
		db,
		folders,
		holds: reconciler,
		files: reader,
		sources,
		learnings,
	});
	const map = wireMap({
		access: deps.access,
		folders,
		documents,
		index: search,
		learnings,
		asked: review,
		holds: reconciler,
	});

	return {
		// The sync with the Space and the files.
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
				await logged(projectId, {
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
		// The search.
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
		meaning: search.meaning,
		setMeaning: (actor, spaceId, projectId, on) =>
			setProjectMeaning({
				access: deps.access,
				documents,
				meaning: (id) => search.meaning(id),
			})({ actor, spaceId, projectId, on }),
		async evaluate(projectId) {
			return search.evaluate(projectId, await review.questionSet(projectId));
		},
		// The page readers.
		look: readers.look,
		setReader: readers.choose,
		// The learnings.
		learnings: learnings.ofProjects,
		settleLearning: learnings.settle,
		settleNote: learnings.settleNote,
		tellLearning: learnings.tell,
		proposeFromRun: learnings.proposeFromRun,
		knownLearnings: learnings.known,
		learnsFromRuns: learnings.learnsFromRuns,
		setLearnsFromRuns: learnings.setLearnsFromRuns,
		followRuns: learnings.followRuns,
		// The sources, the Map and the review.
		review: review.review,
		questions: review.questions,
		markQuestion: review.markQuestion,
		map: map.map,
		markNotTopic: map.markNotTopic,
		use: review.use,
		sources: sources.sourcesIn,
		// The steps and the end.
		forCommand: steps.forCommand,
		forSession: steps.forSession,
		close() {
			late.stopTimers();
			search.close();
			readers.close().catch(() => {});
		},
	};
}
