import type { KnowledgeUse } from "@nightshift/agents/knowledge";
import type { EventInput } from "./events";
import type { KnowledgeVia } from "./space-payloads";

export type { KnowledgeUseEvent } from "../../contract";

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
				payload: {
					projectId,
					path: use.path,
					found: use.found,
					via,
					...(use.from ? { from: use.from } : {}),
				},
			};
}
