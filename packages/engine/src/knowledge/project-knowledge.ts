import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { GraphDocument } from "@langchain/community/graphs/document";
import { Document } from "@langchain/core/documents";
import {
	KNOWLEDGE_TOOLS_INSTRUCTION,
	type KnowledgePort,
	type KnowledgeUse,
	knowledgeTools,
} from "@nightshift/agents/tools";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";
import { knowledgeFolderPath } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import { writeWhole } from "../archive";
import { type CollectResult, collectContent } from "./collect";
import { createKnowledgeFolders, INDEX_FILE, isReadable } from "./folder";
import { TopicGraphTransformer } from "./graph";
import {
	type KnowledgeDocuments,
	knowledgeEntries,
	meaningIsOn,
	setMeaning,
} from "./knowledge-document";
import {
	ACCEPTED_DIR,
	keepLearnings,
	PROPOSED_DIR,
	proposalOf,
	withLearnings,
} from "./learnings";
import {
	formatQuestions,
	type KnowledgeQuestion,
	markQuestion,
	parseQuestions,
	QUESTIONS_FILE,
} from "./questions";
import { createKnowledgeSync, type KnowledgeSyncDeps } from "./reconcile";
import type { KnowledgeSearch } from "./search";
import { createKnowledgeView, inFolders, type KnowledgeView } from "./view";

/**
 * A project's knowledge on this Device, as one module: its folder, the
 * reconcile with the Space (ADR 4), the index and the search, the
 * learnings, and the order between them.
 *
 * A step gets the knowledge in one call (`forCommand`, `forSession`) and
 * gives it back with `done`. Between the two, the step holds the folder:
 * the reconcile before it brings the Space's changes in, the one after it
 * publishes what the step wrote, and nothing else reconciles the folder
 * in between. The Knowledge page (`listing`) and the timers
 * (`reconcileAll`, `retryPending`) skip a project a step holds, and
 * `removeFolder` refuses it. A reconcile that fails leaves the folder as
 * it is: the step goes on.
 *
 * Every Command and every Agent session gets the folder's path in
 * `NS_KNOWLEDGE`, so a sync kit knows where to write. An agent also gets
 * the folder to read, one line that says where it is, a fresh `INDEX.md`,
 * `search_knowledge` and `read_knowledge` over this Device's index (where
 * its harness takes Night Shift's own tools), and may propose learnings:
 * when the folder has files or its node asks for it.
 */

/** The files a graph reads, at most: it reads them one by one. */
const GRAPH_MAX_FILES = 200;
/** How much of each file a graph reads. */
const GRAPH_MAX_BYTES = 60_000;

/** What the Map of a project's knowledge is made from. */
export type KnowledgeGraphInput = {
	files: string[];
	documents: GraphDocument[];
	filesLeftOut: number;
};

/** The environment variable with the folder's path. */
export const KNOWLEDGE_ENV = "NS_KNOWLEDGE";

/** What a step asks of the project's knowledge. */
export type KnowledgeRequest = {
	projectId: string;
	/**
	 * The node asks for the folder (`knowledge: true`): the agent gets it
	 * even when it is empty. Else only when it has files.
	 */
	always?: boolean;
	/**
	 * The node lists folders of the knowledge (`knowledge: [...]`): the
	 * agent gets a view of those only (`view.ts`), even when it is empty.
	 */
	folders?: readonly string[];
};

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

/** What a Command step gets: the folder in `NS_KNOWLEDGE`. */
export type CommandKnowledge = {
	env: Record<string, string>;
	/** The step ended: what it wrote goes to the Space. */
	done(): Promise<void>;
};

/**
 * The agent of a session searched or read the project's knowledge, with
 * its tools: the step logs it (`KnowledgeSearched`, `KnowledgeRead`).
 */
export type KnowledgeUseEvent = {
	type: "knowledge";
	projectId: string;
	use: KnowledgeUse;
};

/** What an Agent session gets. */
export type SessionKnowledge = CommandKnowledge & {
	/** The session's input besides `env`: the folder, the line, the tools, the learnings. */
	input: Pick<
		AgentSessionInput,
		"addDirs" | "instructions" | "tools" | "toolsInstruction" | "stepReport"
	>;
	/**
	 * The session's events as they are, its learnings kept as proposals of
	 * the run, and each use of the knowledge tools before the next event.
	 */
	events(
		events: AsyncIterable<AgentEvent>,
	): AsyncIterable<AgentEvent | KnowledgeUseEvent>;
};

export type ProjectKnowledgeDeps = Pick<
	KnowledgeSyncDeps,
	"db" | "deviceId" | "pageWaitMs" | "archive"
> & {
	/** Where this computer keeps its data: the folders. */
	dataDir: string;
	documents: Pick<KnowledgeDocuments, "open" | "remove">;
	/** This computer's index over the folders. */
	search: Pick<KnowledgeSearch, "search" | "refresh">;
};

/** The line an agent gets next to its prompt. */
function knowledgeLine(path: string): string {
	return `Project knowledge is in ${path}. Read ${INDEX_FILE} there first, then grep the folder for what you need. Do not change the folder.`;
}

/** The session's events, each with the uses of the knowledge that came before it in front. */
async function* withUses(
	events: AsyncIterable<AgentEvent>,
	uses: KnowledgeUseEvent[],
): AsyncGenerator<AgentEvent | KnowledgeUseEvent> {
	for await (const event of events) {
		yield* uses.splice(0);
		yield event;
	}
	yield* uses.splice(0);
}

/** The step an Agent session runs for. */
type SessionStep = {
	runId?: string;
	/** The step of the run: its proposals have a file of their own. */
	stepId?: string;
	stepReport?: AgentSessionInput["stepReport"];
};

/** A project's knowledge on this Device. */
export type ProjectKnowledge = ReturnType<typeof createProjectKnowledge>;

export function createProjectKnowledge(deps: ProjectKnowledgeDeps) {
	const folders = createKnowledgeFolders(deps.dataDir);
	/** The devices runtime, made after this: until then content stays here. */
	let hosts: KnowledgeHosts | null = null;
	const sync = createKnowledgeSync({
		db: deps.db,
		folders,
		documents: deps.documents,
		archive: deps.archive,
		deviceId: deps.deviceId,
		inStep: async (spaceId, names, options) =>
			hosts?.inStep(spaceId, names, options),
		...(deps.pageWaitMs !== undefined ? { pageWaitMs: deps.pageWaitMs } : {}),
	});

	/** The question set's file in this computer's folder, or null. */
	function readQuestions(projectId: string): Promise<string | null> {
		const file = join(folders.folder(projectId), ...QUESTIONS_FILE.split("/"));
		return readFile(file, "utf8").catch(() => null);
	}

	/** The step holds the folder: a reconcile first, and `done` for the one after. */
	/** The latest graph input of each project, with the files it is for. */
	const graphs = new Map<string, { key: string; input: KnowledgeGraphInput }>();

	async function begin(projectId: string) {
		const hold = await sync.startStep(projectId);
		const path = folders.folder(projectId);
		return { hold, path, env: { [KNOWLEDGE_ENV]: path } };
	}

	/**
	 * The knowledge tools of a session in the run's project only, and in
	 * `folders` only when given. `onUse` hears each search and read.
	 */
	function tools(
		projectId: string,
		onUse: (projectId: string, use: KnowledgeUse) => void,
		folders?: readonly string[],
	) {
		const port: KnowledgePort = {
			searchKnowledge: (id, query, limit) =>
				deps.search.search(id, query, {
					limit,
					...(folders ? { folders } : {}),
				}),
			readKnowledge: async (id, path, maxBytes, from) => {
				if (!folders) return sync.read(id, path, maxBytes, from);
				// A file outside the folders is not there for this agent.
				const clean = knowledgeFolderPath(path);
				if (clean === null || !inFolders(clean, folders)) return null;
				return sync.read(id, clean, maxBytes, from);
			},
		};
		return {
			tools: knowledgeTools(port, { project: { id: projectId } }, { onUse }),
			toolsInstruction: KNOWLEDGE_TOOLS_INSTRUCTION,
		};
	}

	/** The index catches up with the folder from now on, not at the first search. */
	function refreshSearch(projectId: string): void {
		deps.search.refresh(projectId).catch((error) => {
			console.warn(
				"The knowledge search index was not brought up to date:",
				error,
			);
		});
	}

	/**
	 * What a session gets of the knowledge: `shown` in `NS_KNOWLEDGE`, to
	 * read and in the line; the tools, in `only` when given; and for a step
	 * of a run, the learnings, kept in the folder `path`.
	 */
	function given(
		projectId: string,
		path: string,
		shown: string,
		step: SessionStep,
		done: () => Promise<void>,
		only?: readonly string[],
	): SessionKnowledge {
		const { runId, stepId } = step;
		// The tools answer while the harness waits: their uses go out before its next event.
		const uses: KnowledgeUseEvent[] = [];
		const onUse = (id: string, use: KnowledgeUse) => {
			uses.push({ type: "knowledge", projectId: id, use });
		};
		return {
			env: { [KNOWLEDGE_ENV]: shown },
			input: {
				addDirs: [shown],
				instructions: knowledgeLine(shown),
				...tools(projectId, onUse, only),
				// An agent of a run that reads the knowledge may propose to add to it.
				...(runId !== undefined && step.stepReport
					? { stepReport: withLearnings(step.stepReport) }
					: {}),
			},
			events: (events) =>
				withUses(
					runId === undefined
						? events
						: keepLearnings(events, path, {
								runId,
								...(stepId !== undefined ? { stepId } : {}),
							}),
					uses,
				),
			done,
		};
	}

	return {
		/**
		 * The Hosts of the Spaces, from the devices runtime: from now on a
		 * reconcile waits for the document to be in step with its Host's.
		 * The content travels through the archive, which the runtime
		 * connects itself.
		 */
		connect(runtime: KnowledgeHosts): void {
			hosts = runtime;
		},
		/** A Command step starts: the folder, made for it, in `NS_KNOWLEDGE`. */
		async forCommand(request: KnowledgeRequest): Promise<CommandKnowledge> {
			const { hold, env } = await begin(request.projectId);
			// The sync flows write here. A folder that cannot be made is left out.
			const made = await folders
				.ensure(request.projectId)
				.then(() => true)
				.catch(() => false);
			return { env: made ? env : {}, done: hold.done };
		},
		/**
		 * An Agent session starts: the folder in `NS_KNOWLEDGE`, and when it
		 * has files or the node asks for it, the folder to read with a fresh
		 * index, the line, the tools and, for a step of a run (`runId`), the
		 * learnings. The index catches up with the folder from now on, not at
		 * the first search.
		 *
		 * With `folders`: a view of those folders instead (`view.ts`), even
		 * when it is empty. `NS_KNOWLEDGE`, the line and the folder to read
		 * are the view's, the tools find nothing else, and the session never
		 * gets the folder's path. Its learnings still go to the folder's
		 * `learnings/proposed/`. The view goes when the step ends. A view that
		 * cannot be made gives no knowledge, never the whole folder.
		 */
		async forSession(
			request: KnowledgeRequest,
			step: SessionStep = {},
		): Promise<SessionKnowledge> {
			const { projectId } = request;
			const { hold, path, env } = await begin(projectId);
			if (request.folders) {
				const only = request.folders;
				let view: KnowledgeView;
				try {
					view = await createKnowledgeView(
						path,
						await folders.files(projectId),
						only,
					);
				} catch (error) {
					console.warn("The knowledge was left out:", error);
					return {
						env: {},
						input: {},
						events: (events) => events,
						done: hold.done,
					};
				}
				refreshSearch(projectId);
				const done = async () => {
					try {
						await view.remove();
					} finally {
						await hold.done();
					}
				};
				return given(projectId, path, view.path, step, done, only);
			}
			const plain: SessionKnowledge = {
				env,
				input: {},
				events: (events) => events,
				done: hold.done,
			};
			try {
				const files = await folders.files(projectId);
				if (files.length === 0 && !request.always) return plain;
				await folders.index(projectId);
			} catch (error) {
				console.warn("The knowledge folder was left out:", error);
				return plain;
			}
			refreshSearch(projectId);
			return given(projectId, path, path, step, hold.done);
		},
		/**
		 * Removes the content of the Spaces this Replica keeps that no
		 * knowledge document lists any more, after a grace period
		 * (`collectContent`). Nothing before the devices runtime connects.
		 */
		async collect(): Promise<CollectResult> {
			const keeps = hosts?.keeps?.bind(hosts);
			if (!keeps) return { removed: 0, waiting: 0 };
			return collectContent({
				db: deps.db,
				documents: deps.documents,
				archive: deps.archive,
				keeps,
			});
		},
		/**
		 * Projects moved to other Spaces (`Engine.moveProjects`): each one's
		 * knowledge follows it, to its new id when it has one: the document,
		 * the folder, the content and the search index (`KnowledgeSync.move`).
		 * The next reconcile copies the content to the new Space's Host.
		 */
		async moved(move: {
			from: string;
			projects: Readonly<
				Record<string, { spaceId: string; projectId: string }>
			>;
		}): Promise<void> {
			for (const [projectId, to] of Object.entries(move.projects)) {
				await sync.move({ from: { spaceId: move.from, projectId }, to });
				if (to.projectId === projectId) continue;
				// The old id's folder is gone: its rows leave the index.
				await deps.search.refresh(projectId).catch(() => {});
				deps.search.refresh(to.projectId).catch(() => {});
			}
			for (const to of Object.values(move.projects)) {
				sync.reconcile(to.projectId).catch(() => {});
			}
		},
		/**
		 * The project's question set (`questions.ts`), as the Space has it:
		 * the folder is brought in step first, as for a step.
		 */
		async questions(projectId: string): Promise<KnowledgeQuestion[]> {
			const hold = await sync.startStep(projectId);
			try {
				return parseQuestions(await readQuestions(projectId));
			} finally {
				await hold.done();
			}
		},
		/**
		 * Marks the files that answer a question an agent asked, or with no
		 * files (or none an agent reads) takes it out of the set. The set goes to the Space as a
		 * step's changes do. Returns the set.
		 */
		async markQuestion(
			projectId: string,
			mark: { query: string; answers: readonly string[]; by: string | null },
		): Promise<KnowledgeQuestion[]> {
			const hold = await sync.startStep(projectId);
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
					...QUESTIONS_FILE.split("/"),
				);
				await writeWhole(file, formatQuestions(next));
				return next;
			} finally {
				await hold.done();
			}
		},
		/**
		 * Keeps or deletes one step's proposals, as the review of learnings
		 * (`kit:knowledge/review-learnings`) does: keep adds them to
		 * `learnings/accepted/`, where agents read them, and both take them
		 * out of `learnings/proposed/`. It holds the folder as a step does,
		 * so the change goes to the Space when it ends. Refuses a proposal
		 * that no longer waits, and one whose content cannot be fetched now.
		 */
		async settleLearning(
			projectId: string,
			id: string,
			decision: "keep" | "delete",
		): Promise<void> {
			const gone = new Refusal(
				"not-found",
				"This learning no longer waits. Someone kept or deleted it.",
			);
			if (!proposalOf(id)) throw gone;
			const hold = await sync.startStep(projectId);
			try {
				const root = folders.folder(projectId);
				const proposed = join(root, ...PROPOSED_DIR.split("/"), id);
				const content = await readFile(proposed).catch(() => null);
				if (content === null) {
					// Listed in the Space, but its content did not reach this folder.
					const listed = knowledgeEntries(
						await deps.documents.open(projectId),
					).has(`${PROPOSED_DIR}/${id}`);
					if (!listed) throw gone;
					throw new Refusal(
						"unavailable",
						"Night Shift cannot get this learning now. Try again when the computer that keeps this Space is online.",
					);
				}
				if (decision === "keep") {
					const accepted = join(root, ...ACCEPTED_DIR.split("/"));
					await mkdir(accepted, { recursive: true });
					await appendFile(join(accepted, id), content);
				}
				await rm(proposed, { force: true });
			} finally {
				await hold.done();
			}
		},
		/**
		 * What the Map of the knowledge is made from: every file, and what the
		 * transformer found in the files it could read. It reads them only
		 * when a file changed. A file it cannot read stays on the map, alone.
		 */
		async graphInput(projectId: string): Promise<KnowledgeGraphInput> {
			const { files } = await sync.listing(projectId);
			const key = files
				.map((file) => `${file.path}:${file.size}:${file.changedAt}`)
				.join("\n");
			const known = graphs.get(projectId);
			if (known?.key === key) return known.input;
			const readable = files.filter(
				(file) => isReadable(file.path) && !file.local,
			);
			const documents: Document[] = [];
			for (const file of readable.slice(0, GRAPH_MAX_FILES)) {
				const text = await sync
					.read(projectId, file.path, GRAPH_MAX_BYTES)
					.catch(() => null);
				if (text) {
					documents.push(
						new Document({
							pageContent: text.text,
							metadata: { path: file.path },
						}),
					);
				}
			}
			const input: KnowledgeGraphInput = {
				files: files.map((file) => file.path),
				documents: await new TopicGraphTransformer().convertToGraphDocuments(
					documents,
				),
				filesLeftOut: Math.max(0, readable.length - GRAPH_MAX_FILES),
			};
			graphs.set(projectId, { key, input });
			return input;
		},
		/** Whether search by meaning is on for the project, in every Device of its Space. */
		async meaningOn(projectId: string): Promise<boolean> {
			return meaningIsOn(await deps.documents.open(projectId));
		},
		/** Turns search by meaning on or off for the project, for every Device of its Space. */
		async setMeaning(projectId: string, on: boolean): Promise<void> {
			await setMeaning(await deps.documents.open(projectId), on);
		},
		listing: sync.listing,
		waitingLearnings: sync.waitingLearnings,
		read: sync.read,
		removeFolder: sync.removeFolder,
		reconcileAll: sync.reconcileAll,
		retryPending: sync.retryPending,
	};
}
