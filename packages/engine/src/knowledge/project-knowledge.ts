import {
	KNOWLEDGE_TOOLS_INSTRUCTION,
	type KnowledgePort,
	knowledgeTools,
} from "@nightshift/agents/tools";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";
import { type CollectResult, collectContent } from "./collect";
import { createKnowledgeFolders, INDEX_FILE } from "./folder";
import type { KnowledgeDocuments } from "./knowledge-document";
import { keepLearnings, withLearnings } from "./learnings";
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

/** What an Agent session gets. */
export type SessionKnowledge = CommandKnowledge & {
	/** The session's input besides `env`: the folder, the line, the tools, the learnings. */
	input: Pick<
		AgentSessionInput,
		"addDirs" | "instructions" | "tools" | "toolsInstruction" | "stepReport"
	>;
	/** The session's events as they are, its learnings kept as proposals of the run. */
	events(events: AsyncIterable<AgentEvent>): AsyncIterable<AgentEvent>;
};

export type ProjectKnowledgeDeps = Pick<
	KnowledgeSyncDeps,
	"db" | "deviceId" | "pageWaitMs" | "archive"
> & {
	/** Where this computer keeps its data: the folders. */
	dataDir: string;
	documents: Pick<KnowledgeDocuments, "open">;
	/** This computer's index over the folders. */
	search: Pick<KnowledgeSearch, "search" | "refresh">;
};

/** The line an agent gets next to its prompt. */
function knowledgeLine(path: string): string {
	return `Project knowledge is in ${path}. Read ${INDEX_FILE} there first, then grep the folder for what you need. Do not change the folder.`;
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

	/** The step holds the folder: a reconcile first, and `done` for the one after. */
	async function begin(projectId: string) {
		const hold = await sync.startStep(projectId);
		const path = folders.folder(projectId);
		return { hold, path, env: { [KNOWLEDGE_ENV]: path } };
	}

	/** The knowledge tools of a session in the run's project only. */
	function tools(projectId: string) {
		const port: KnowledgePort = {
			searchKnowledge: (id, query, limit) =>
				deps.search.search(id, query, { limit }),
			readKnowledge: (id, path, maxBytes) => sync.read(id, path, maxBytes),
		};
		return {
			tools: knowledgeTools(port, { project: { id: projectId } }),
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
			const { runId } = step;
			return {
				env,
				input: {
					addDirs: [path],
					instructions: knowledgeLine(path),
					...tools(projectId),
					// An agent of a run that reads the knowledge may propose to add to it.
					...(runId !== undefined && step.stepReport
						? { stepReport: withLearnings(step.stepReport) }
						: {}),
				},
				events: (events) =>
					runId === undefined ? events : keepLearnings(events, path, runId),
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
		listing: sync.listing,
		read: sync.read,
		removeFolder: sync.removeFolder,
		reconcileAll: sync.reconcileAll,
		retryPending: sync.retryPending,
	};
}
