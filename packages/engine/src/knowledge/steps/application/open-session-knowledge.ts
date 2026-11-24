import type { KnowledgePort, KnowledgeUse } from "@nightshift/agents/knowledge";
import type { AgentEvent } from "@nightshift/agents/types";
import { knowledgeFolderPath } from "@nightshift/flows";
import type {
	KnowledgeRequest,
	KnowledgeUseEvent,
	SessionKnowledge,
	SessionStep,
} from "../../../contract";
import type { FolderSnapshot } from "../../../folder-snapshot";
import {
	inFolders,
	type KnowledgeFiles,
	type KnowledgeFolders,
	type KnowledgeReader,
	type KnowledgeView,
} from "../../files";
import type { Learnings } from "../../learnings";
import type { KnowledgeSearch } from "../../search";
import type { KnowledgeReconciler } from "../../sync";
import type { StepBrief } from "./ports";

export type OpenSessionKnowledgePorts = {
	holds: Pick<KnowledgeReconciler, "startStep">;
	folders: Pick<KnowledgeFolders, "folder" | "scan">;
	files: Pick<KnowledgeFiles, "writeIndex" | "openView">;
	reader: Pick<KnowledgeReader, "read">;
	search: Pick<KnowledgeSearch, "search" | "refresh">;
	learnings: Pick<Learnings, "keepReported">;
	brief: Pick<StepBrief, "env" | "session">;
};

/** What the session asks of the knowledge, and the step of the run it is for. */
export type OpenSessionKnowledge = {
	request: KnowledgeRequest;
	step?: SessionStep;
};

/** A session that gets none of the knowledge. */
const nothing = {
	contribution: {},
	events: (events: AsyncIterable<AgentEvent>) => events,
} satisfies Omit<SessionKnowledge, "done">;

/**
 * An Agent session starts: it holds the folder (a reconcile first) and
 * gives its path in `NS_KNOWLEDGE`. When the folder has files or the node
 * asks for it, the session also gets the folder to read with a fresh
 * `INDEX.md`, the brief with the tools, and for a step of a run its
 * learnings. The index of the search catches up with the folder from now
 * on. It gets nothing when the request asks for nothing.
 *
 * With `knowledgeOnly`: a view of those folders instead, even when it is
 * empty. The view goes when the step ends. A view that cannot be made
 * gives no knowledge, never the whole folder.
 */
export const openSessionKnowledge =
	(ports: OpenSessionKnowledgePorts) =>
	async ({
		request,
		step = {},
	}: OpenSessionKnowledge): Promise<SessionKnowledge> => {
		const { knowledgeOnly, knowledge } = request;
		const asked = knowledgeOnly ?? knowledge;
		if (!asked) return { ...nothing, done: async () => {} };
		const { projectId } = asked;
		const hold = await ports.holds.startStep(projectId);
		const path = ports.folders.folder(projectId);
		if (knowledgeOnly) {
			const only = knowledgeOnly.folders;
			let view: KnowledgeView;
			let snapshot: FolderSnapshot;
			try {
				// After the reconcile, which writes the folder.
				snapshot = await ports.folders.scan(projectId);
				view = await ports.files.openView(path, snapshot.readable, only);
			} catch (error) {
				console.warn("The knowledge was left out:", error);
				return { ...nothing, done: hold.done };
			}
			refreshSearch(ports, projectId, snapshot);
			const done = async () => {
				try {
					await view.remove();
				} finally {
					await hold.done();
				}
			};
			return given(ports, { projectId, shown: view.path, step, done, only });
		}
		const plain: SessionKnowledge = {
			...nothing,
			contribution: { env: ports.brief.env(path) },
			done: hold.done,
		};
		let snapshot: FolderSnapshot;
		try {
			// After the reconcile, which writes the folder.
			snapshot = await ports.folders.scan(projectId);
			if (snapshot.readable.length === 0 && !knowledge?.always) return plain;
			await ports.files.writeIndex(snapshot);
		} catch (error) {
			console.warn("The knowledge folder was left out:", error);
			return plain;
		}
		refreshSearch(ports, projectId, snapshot);
		return given(ports, { projectId, shown: path, step, done: hold.done });
	};

/** The index catches up with the folder from now on, not at the first search. */
function refreshSearch(
	ports: Pick<OpenSessionKnowledgePorts, "search">,
	projectId: string,
	snapshot: FolderSnapshot,
): void {
	ports.search.refresh(projectId, snapshot).catch((error) => {
		console.warn(
			"The knowledge search index was not brought up to date:",
			error,
		);
	});
}

/**
 * The knowledge tools' port in the run's project only, and in `only` when
 * given: a file outside those folders is not there for this agent.
 */
function toolsPort(
	ports: Pick<OpenSessionKnowledgePorts, "search" | "reader">,
	only?: readonly string[],
): KnowledgePort {
	return {
		searchKnowledge: (id, query, limit) =>
			ports.search.search(id, query, {
				limit,
				...(only ? { folders: only } : {}),
			}),
		readKnowledge: async (id, path, maxBytes, from) => {
			if (!only) return ports.reader.read(id, path, maxBytes, from);
			// A file outside the folders is not there for this agent.
			const clean = knowledgeFolderPath(path);
			if (clean === null || !inFolders(clean, only)) return null;
			return ports.reader.read(id, clean, maxBytes, from);
		},
	};
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

/**
 * What a session gets of the knowledge: `shown` in `NS_KNOWLEDGE`, to read
 * and in the line; the tools, in `only` when given; and for a step of a
 * run, the learnings, kept in the project's folder.
 */
function given(
	ports: Pick<
		OpenSessionKnowledgePorts,
		"search" | "reader" | "learnings" | "brief"
	>,
	session: {
		projectId: string;
		shown: string;
		step: SessionStep;
		done: () => Promise<void>;
		only?: readonly string[];
	},
): SessionKnowledge {
	const { projectId, shown, step, done, only } = session;
	const { runId, stepId } = step;
	// The tools answer while the harness waits: their uses go out before its next event.
	const uses: KnowledgeUseEvent[] = [];
	const onUse = (id: string, use: KnowledgeUse) => {
		uses.push({ type: "knowledge", projectId: id, use });
	};
	return {
		contribution: ports.brief.session({
			folder: shown,
			projectId,
			tools: toolsPort(ports, only),
			onUse,
			// An agent of a run that reads the knowledge may propose to add to it.
			learnings: runId !== undefined,
		}),
		events: (events) =>
			withUses(
				runId === undefined
					? events
					: ports.learnings.keepReported({
							events,
							projectId,
							step: { runId, ...(stepId !== undefined ? { stepId } : {}) },
						}),
				uses,
			),
		done,
	};
}
