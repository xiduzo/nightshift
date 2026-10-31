import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	KNOWLEDGE_TOOLS_INSTRUCTION,
	type KnowledgePort,
	type KnowledgeUse,
	knowledgeTools,
} from "@nightshift/agents/tools";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";
import { writeWhole } from "../archive";
import { type CollectResult, collectContent } from "./collect";
import { createKnowledgeFolders, INDEX_FILE, isReadable } from "./folder";
import type { KnowledgeDocuments } from "./knowledge-document";
import { keepLearnings, withLearnings } from "./learnings";
import {
	formatQuestions,
	type KnowledgeQuestion,
	markQuestion,
	parseQuestions,
	QUESTIONS_FILE,
} from "./questions";
import { createKnowledgeSync, type KnowledgeSyncDeps } from "./reconcile";
import type { KnowledgeSearch } from "./search";

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
	async function begin(projectId: string) {
		const hold = await sync.startStep(projectId);
		const path = folders.folder(projectId);
		return { hold, path, env: { [KNOWLEDGE_ENV]: path } };
	}

	/** The knowledge tools of a session in the run's project only. `onUse` hears each search and read. */
	function tools(
		projectId: string,
		onUse: (projectId: string, use: KnowledgeUse) => void,
	) {
		const port: KnowledgePort = {
			searchKnowledge: (id, query, limit) =>
				deps.search.search(id, query, { limit }),
			readKnowledge: (id, path, maxBytes) => sync.read(id, path, maxBytes),
		};
		return {
			tools: knowledgeTools(port, { project: { id: projectId } }, { onUse }),
			toolsInstruction: KNOWLEDGE_TOOLS_INSTRUCTION,
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
		 */
		async forSession(
			request: KnowledgeRequest,
			step: {
				runId?: string;
				/** The step of the run: its proposals have a file of their own. */
				stepId?: string;
				stepReport?: AgentSessionInput["stepReport"];
			} = {},
		): Promise<SessionKnowledge> {
			const { projectId } = request;
			const { hold, path, env } = await begin(projectId);
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
			deps.search.refresh(projectId).catch((error) => {
				console.warn(
					"The knowledge search index was not brought up to date:",
					error,
				);
			});
			const { runId, stepId } = step;
			// The tools answer while the harness waits: their uses go out before its next event.
			const uses: KnowledgeUseEvent[] = [];
			const onUse = (id: string, use: KnowledgeUse) => {
				uses.push({ type: "knowledge", projectId: id, use });
			};
			return {
				env,
				input: {
					addDirs: [path],
					instructions: knowledgeLine(path),
					...tools(projectId, onUse),
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
				done: hold.done,
			};
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
						at: Date.now(),
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
		listing: sync.listing,
		read: sync.read,
		removeFolder: sync.removeFolder,
		reconcileAll: sync.reconcileAll,
		retryPending: sync.retryPending,
	};
}
