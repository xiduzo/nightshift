import {
	type KnowledgePort,
	type KnowledgeUse,
	knowledgeBrief,
	knowledgeEnv,
	knowledgeTools,
} from "@nightshift/agents/knowledge";
import type { AgentEvent } from "@nightshift/agents/types";
import { knowledgeFolderPath } from "@nightshift/flows";
import type {
	CommandKnowledge,
	KnowledgeRequest,
	KnowledgeUseEvent,
	SessionKnowledge,
	SessionStep,
} from "../contract";
import { indexFolder, type KnowledgeFolders } from "./folder";
import type { FolderSnapshot } from "./folder-snapshot";
import type { KnowledgeReader } from "./knowledge-reader";
import type { Learnings } from "./learnings";
import type { PageReaders, ReaderSecret } from "./readers/service";
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

export type {
	CommandKnowledge,
	KnowledgeRequest,
	SessionKnowledge,
	SessionStep,
} from "../contract";

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
	/** The page readers: a Command step gets the project's. Without them, none. */
	readers?: Pick<PageReaders, "forStep">;
}) {
	const { folders, reconciler, reader, search, learnings } = deps;

	/** The step's page reader. One that cannot open leaves the step without it: the kit reads as before. */
	async function pageReader(projectId: string, secret: ReaderSecret) {
		try {
			return (await deps.readers?.forStep(projectId, secret)) ?? null;
		} catch (error) {
			console.warn("The page reader of the step did not open:", error);
			return null;
		}
	}

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
		async forCommand(
			projectId: string,
			step: { secret?: ReaderSecret } = {},
		): Promise<CommandKnowledge> {
			const { hold, path } = await begin(projectId);
			// The sync flows write here. A folder that cannot be made is left out.
			const made = await folders
				.ensure(projectId)
				.then(() => true)
				.catch(() => false);
			if (!made) return { env: {}, done: hold.done };
			const pages = await pageReader(
				projectId,
				step.secret ?? (async () => undefined),
			);
			return {
				env: { ...knowledgeEnv(path), ...pages?.env },
				async done() {
					try {
						await pages?.close();
					} finally {
						await hold.done();
					}
				},
			};
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
