import type { KnowledgeUse } from "@nightshift/agents/tools";
import type { EventInput, KnowledgeVia, RunLog } from "../log";

/**
 * How agents use a project's knowledge, from the event log: each search
 * (`KnowledgeSearched`) and each read (`KnowledgeRead`) of an agent. An
 * Agent step logs its own on its step (`StepHandle.usedKnowledge`); the
 * nightshift MCP server's calls are logged with no run (`logKnowledgeUse`).
 */

/** The event of one use of the knowledge, without its run, step or session. */
export function knowledgeUseEvent(
	projectId: string,
	use: KnowledgeUse,
	via: KnowledgeVia,
): EventInput<"KnowledgeSearched"> | EventInput<"KnowledgeRead"> {
	return use.kind === "search"
		? {
				type: "KnowledgeSearched",
				payload: { projectId, query: use.query, hits: use.hits, via },
			}
		: {
				type: "KnowledgeRead",
				payload: { projectId, path: use.path, found: use.found, via },
			};
}

/** Logs a use of the knowledge through the nightshift MCP server: a fact of the project, with no run. */
export async function logKnowledgeUse(
	log: Pick<RunLog, "append">,
	projectId: string,
	use: KnowledgeUse,
): Promise<void> {
	await log.append(knowledgeUseEvent(projectId, use, "mcp"));
}
