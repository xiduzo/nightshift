import {
	KNOWLEDGE_TOOLS_INSTRUCTION,
	type KnowledgePort,
	knowledgeTools,
} from "@nightshift/agents/tools";
import type { AgentEvent, AgentSessionInput } from "@nightshift/agents/types";
import { INDEX_FILE, type KnowledgeFolders } from "./folder";
import type { KnowledgeSearch } from "./search";

/**
 * How a step gets the project's knowledge folder, on the Device that runs
 * it. Every Command and every Agent session gets its path in
 * `NS_KNOWLEDGE`, so a sync kit knows where to write. An agent also gets
 * the folder to read (`addDirs`) and one line that says where it is, when
 * the folder has files or its node asks for it. With the folder, an agent
 * whose harness takes Night Shift's own tools also gets `search_knowledge`
 * and `read_knowledge` over this Device's index (`sessionKnowledgeTools`).
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

/** The line an agent gets next to its prompt. */
export function knowledgeLine(path: string): string {
	return `Project knowledge is in ${path}. Read ${INDEX_FILE} there first, then grep the folder for what you need. Do not change the folder.`;
}

/** The folder in `NS_KNOWLEDGE`, made when it is not there yet. */
export async function commandKnowledge(
	folders: KnowledgeFolders,
	request: KnowledgeRequest,
): Promise<Record<string, string>> {
	return { [KNOWLEDGE_ENV]: await folders.ensure(request.projectId) };
}

/**
 * What an agent session gets: the folder in `NS_KNOWLEDGE`, and, when the
 * folder has files or the node asks for it, the folder to read and the
 * line, with a fresh index.
 */
export async function sessionKnowledge(
	folders: KnowledgeFolders,
	request: KnowledgeRequest,
): Promise<{
	env: Record<string, string>;
	addDirs?: string[];
	instructions?: string;
}> {
	const path = folders.folder(request.projectId);
	const env = { [KNOWLEDGE_ENV]: path };
	const files = await folders.files(request.projectId);
	if (files.length === 0 && !request.always) return { env };
	await folders.index(request.projectId);
	return { env, addDirs: [path], instructions: knowledgeLine(path) };
}

/**
 * The knowledge tools of an Agent step that gets the folder: this
 * Device's own index, in the run's project only, and what the agent
 * learns about them. The harness drops both when it cannot take them.
 */
export function sessionKnowledgeTools(
	search: Pick<KnowledgeSearch, "search" | "read">,
	projectId: string,
): Required<Pick<AgentSessionInput, "tools" | "toolsInstruction">> {
	const port: KnowledgePort = {
		searchKnowledge: (id, query, limit) => search.search(id, query, { limit }),
		readKnowledge: (id, path, maxBytes) => search.read(id, path, { maxBytes }),
	};
	return {
		tools: knowledgeTools(port, { project: { id: projectId } }),
		toolsInstruction: KNOWLEDGE_TOOLS_INSTRUCTION,
	};
}

/**
 * The step report of an agent that reads the knowledge: it may add
 * `learnings`. A session without a report stays without one.
 */
export function withLearnings(
	stepReport: AgentSessionInput["stepReport"],
): AgentSessionInput["stepReport"] {
	if (!stepReport) return stepReport;
	return stepReport === true
		? { learnings: true }
		: { ...stepReport, learnings: true };
}

/**
 * The session's events as they are, with the learnings of its reports
 * kept as proposals of the run, for a person to review. A note that cannot
 * be kept is left out: the step goes on.
 */
export async function* keepLearnings(
	events: AsyncIterable<AgentEvent>,
	folders: KnowledgeFolders,
	at: { projectId: string; runId: string },
): AsyncGenerator<AgentEvent> {
	for await (const event of events) {
		if (event.type === "report" && event.learnings?.length) {
			await folders
				.propose(at.projectId, at.runId, event.learnings)
				.catch((error) =>
					console.warn("The learnings of a step were not kept:", error),
				);
		}
		yield event;
	}
}
