import {
	KNOWLEDGE_TOOLS_INSTRUCTION,
	type KnowledgePort,
	type KnowledgeUse,
	knowledgeTools,
} from "@nightshift/agents/tools";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";
import { KNOWLEDGE_INDEX_FILE, knowledgeFolderPath } from "@nightshift/flows";
import type { KnowledgeFolders } from "./folder";
import type { KnowledgeReader } from "./knowledge-reader";
import { keepLearnings, withLearnings } from "./learnings";
import type { KnowledgeSync } from "./reconcile";
import type { KnowledgeSearch } from "./search";
import { createKnowledgeView, inFolders, type KnowledgeView } from "./view";

/**
 * What a step gets of the knowledge (`Knowledge.forCommand`,
 * `Knowledge.forSession`), and how it gives it back.
 *
 * Every Command and every Agent session gets the folder's path in
 * `NS_KNOWLEDGE`, so a sync kit knows where to write. An agent also gets
 * the folder to read, one line that says where it is, a fresh `INDEX.md`,
 * `search_knowledge` and `read_knowledge` over this Device's index (where
 * its harness takes Night Shift's own tools), and may propose learnings:
 * when the folder has files or its node asks for it.
 */

/** The environment variable with the folder's path. */
const KNOWLEDGE_ENV = "NS_KNOWLEDGE";

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

/** The step an Agent session runs for. */
export type SessionStep = {
	runId?: string;
	/** The step of the run: its proposals have a file of their own. */
	stepId?: string;
	stepReport?: AgentSessionInput["stepReport"];
};

/** The line an agent gets next to its prompt. */
function knowledgeLine(path: string): string {
	return `Project knowledge is in ${path}. Read ${KNOWLEDGE_INDEX_FILE} there first, then grep the folder for what you need. Do not change the folder.`;
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

export function createStepKnowledge(deps: {
	folders: Pick<KnowledgeFolders, "folder" | "ensure" | "files" | "index">;
	sync: Pick<KnowledgeSync, "startStep">;
	reader: Pick<KnowledgeReader, "read">;
	search: Pick<KnowledgeSearch, "search" | "refresh">;
}) {
	const { folders, sync, reader, search } = deps;

	/** The step holds the folder: a reconcile first, and `done` for the one after. */
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
				search.search(id, query, {
					limit,
					...(folders ? { folders } : {}),
				}),
			readKnowledge: async (id, path, maxBytes, from) => {
				if (!folders) return reader.read(id, path, maxBytes, from);
				// A file outside the folders is not there for this agent.
				const clean = knowledgeFolderPath(path);
				if (clean === null || !inFolders(clean, folders)) return null;
				return reader.read(id, clean, maxBytes, from);
			},
		};
		return {
			tools: knowledgeTools(port, { project: { id: projectId } }, { onUse }),
			toolsInstruction: KNOWLEDGE_TOOLS_INSTRUCTION,
		};
	}

	/** The index catches up with the folder from now on, not at the first search. */
	function refreshSearch(projectId: string): void {
		search.refresh(projectId).catch((error) => {
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
		async forCommand(request: KnowledgeRequest): Promise<CommandKnowledge> {
			const { hold, env } = await begin(request.projectId);
			// The sync flows write here. A folder that cannot be made is left out.
			const made = await folders
				.ensure(request.projectId)
				.then(() => true)
				.catch(() => false);
			return { env: made ? env : {}, done: hold.done };
		},
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
	};
}
