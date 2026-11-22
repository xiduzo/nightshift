import type { Database } from "@nightshift/db";
import { knowledgeUseEvents } from "../../../../log";
import type { KnowledgeUseLog } from "../../application/ports";
import type { KnowledgeUseRow } from "../../domain/use";

/**
 * `KnowledgeUseLog` over the event log in the database: the log's own
 * read of a project's knowledge events (`knowledgeUseEvents`), which
 * finds a use through the MCP server by its payload. `wireReview` builds it.
 */
export function drizzleKnowledgeUseLog(db: Database): KnowledgeUseLog {
	return {
		async events(projectId, types, options) {
			const rows = await knowledgeUseEvents(db, projectId, types, options);
			return rows.flatMap((row): KnowledgeUseRow[] =>
				row.type === "KnowledgeSearched" || row.type === "KnowledgeRead"
					? [row]
					: [],
			);
		},
	};
}
