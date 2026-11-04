import {
	type KnowledgePort,
	type KnowledgeUse,
	knowledgeBrief,
	knowledgeEnv,
	knowledgeTools,
} from "@nightshift/agents/tools";
import type { AgentEvent, SessionContribution } from "@nightshift/agents/types";
import { knowledgeFolderPath } from "@nightshift/flows";
import { indexFolder, type KnowledgeFolders } from "./folder";
import type { FolderSnapshot } from "./folder-snapshot";
import type { KnowledgeReader } from "./knowledge-reader";
import type { Learnings } from "./learnings";
import type { KnowledgeReconciler } from "./reconcile";
import type { KnowledgeSearch } from "./search";
import { createKnowledgeView, inFolders, type KnowledgeView } from "./view";

/**
 * What a step gets of the knowledge (`Knowledge.forCommand`,
 * `Knowledge.forSession`), and how it gives it back.
 *
 * Every Command and every Agent session gets the folder's path in
 * `NS_KNOWLEDGE`, so a sync kit knows where to write. An agent also gets
 * the session brief of `@nightshift/agents`: the folder to read, one line
 * that says where it is, a fresh `INDEX.md`, `search_knowledge` and
 * `read_knowledge` over this Device's index (where its harness takes Night
 * Shift's own tools), and it may propose learnings: when the folder has files
 * or its node asks for it. This module decides when, and which folder. The
 * brief decides what the agent is told.
 */

/**
 * What an Agent session asks of the project's knowledge, as the wire has it.
 * Neither field: the node turned it off (`knowledge: false`).
 */
export type KnowledgeRequest = {
	/**
	 * The whole folder. `always`: the node asks for it (`knowledge: true`),
	 * so the agent gets it even when it is empty. Else only when it has files.
	 */
	knowledge?: { projectId: string; always?: boolean };
	/**
	 * The node lists folders of the knowledge (`knowledge: [...]`): the agent
	 * gets a view of those only (`view.ts`), even when it is empty. Its search
	 * and reads find nothing else. A field of its own, not part of `knowledge`:
	 * a Device that does not know it gives no knowledge, never the whole folder.
	 */
	knowledgeOnly?: { projectId: string; folders: string[] };
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
export type SessionKnowledge = Pick<CommandKnowledge, "done"> & {
	/** What the session gets: `NS_KNOWLEDGE`, and the brief when the agent reads the folder. */
	contribution: SessionContribution;
	/**
	 * The session's events as they are, its learnings kept as proposed learnings of
	 * the run, and each use of the knowledge tools before the next event.
	 */
	events(
		events: AsyncIterable<AgentEvent>,
	): AsyncIterable<AgentEvent | KnowledgeUseEvent>;
};

/** The step an Agent session runs for. */
export type SessionStep = {
	runId?: string;
	/** The step of the run: its proposed learnings have a file of their own. */
	stepId?: string;
};

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

/** A session that gets none of the knowledge. */
const nothing = {
	contribution: {},
	events: (events: AsyncIterable<AgentEvent>) => events,
} satisfies Omit<SessionKnowledge, "done">;

export function createStepKnowledge(deps: {
	folders: Pick<KnowledgeFolders, "folder" | "ensure" | "scan">;
	reconciler: Pick<KnowledgeReconciler, "startStep">;
	reader: Pick<KnowledgeReader, "read">;
	search: Pick<KnowledgeSearch, "search" | "refresh">;
	learnings: Pick<Learnings, "keepReported">;
}) {
	const { folders, reconciler, reader, search, learnings } = deps;

	/** The step holds the folder: a reconcile first, and `done` for the one after. */
	async function begin(projectId: string) {
		const hold = await reconciler.startStep(projectId);
		const path = folders.folder(projectId);
		return { hold, path };
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
		return knowledgeTools(port, { project: { id: projectId } }, { onUse });
	}

	/** The index catches up with the folder from now on, not at the first search. */
	function refreshSearch(projectId: string, snapshot: FolderSnapshot): void {
		search.refresh(projectId, snapshot).catch((error) => {
			console.warn(
				"The knowledge search index was not brought up to date:",
				error,
			);
		});
	}

	/**
	 * What a session gets of the knowledge: `shown` in `NS_KNOWLEDGE`, to
	 * read and in the line; the tools, in `only` when given; and for a step
	 * of a run, the learnings, kept in the project's folder.
	 */
	function given(
		projectId: string,
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
			contribution: knowledgeBrief({
				folder: shown,
				tools: tools(projectId, onUse, only),
				// An agent of a run that reads the knowledge may propose to add to it.
				learnings: runId !== undefined,
			}),
			events: (events) =>
				withUses(
					runId === undefined
						? events
						: learnings.keepReported(events, projectId, {
								runId,
								...(stepId !== undefined ? { stepId } : {}),
							}),
					uses,
				),
			done,
		};
	}

	return {
		async forCommand(projectId: string): Promise<CommandKnowledge> {
			const { hold, path } = await begin(projectId);
			// The sync flows write here. A folder that cannot be made is left out.
			const made = await folders
				.ensure(projectId)
				.then(() => true)
				.catch(() => false);
			return { env: made ? knowledgeEnv(path) : {}, done: hold.done };
		},
		async forSession(
			request: KnowledgeRequest,
			step: SessionStep = {},
		): Promise<SessionKnowledge> {
			const { knowledgeOnly, knowledge } = request;
			const asked = knowledgeOnly ?? knowledge;
			if (!asked) return { ...nothing, done: async () => {} };
			const { projectId } = asked;
			const { hold, path } = await begin(projectId);
			if (knowledgeOnly) {
				const only = knowledgeOnly.folders;
				let view: KnowledgeView;
				let snapshot: FolderSnapshot;
				try {
					// After the reconcile, which writes the folder.
					snapshot = await folders.scan(projectId);
					view = await createKnowledgeView(path, snapshot.readable, only);
				} catch (error) {
					console.warn("The knowledge was left out:", error);
					return { ...nothing, done: hold.done };
				}
				refreshSearch(projectId, snapshot);
				const done = async () => {
					try {
						await view.remove();
					} finally {
						await hold.done();
					}
				};
				return given(projectId, view.path, step, done, only);
			}
			const plain: SessionKnowledge = {
				...nothing,
				contribution: { env: knowledgeEnv(path) },
				done: hold.done,
			};
			let snapshot: FolderSnapshot;
			try {
				// After the reconcile, which writes the folder.
				snapshot = await folders.scan(projectId);
				if (snapshot.readable.length === 0 && !knowledge?.always) return plain;
				await indexFolder(snapshot);
			} catch (error) {
				console.warn("The knowledge folder was left out:", error);
				return plain;
			}
			refreshSearch(projectId, snapshot);
			return given(projectId, path, step, hold.done);
		},
	};
}
