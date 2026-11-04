import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { parseEventRow } from "./events";

/**
 * The knowledge events of a project, newest first, at most `limit`. A use
 * through the nightshift MCP server has no run, so only its payload names the
 * project. This reads that payload in SQL, so it stays here with the log's
 * storage.
 */
export function knowledgeUseEvents(
	db: Database,
	projectId: string,
	types: readonly ("KnowledgeSearched" | "KnowledgeRead")[],
	options: { limit: number; since?: number },
) {
	return db
		.select()
		.from(event)
		.where(
			and(
				inArray(event.type, [...types]),
				sql`json_extract(${event.payload}, '$.projectId') = ${projectId}`,
				options.since === undefined
					? undefined
					: gte(event.at, asDate(options.since)),
			),
		)
		.orderBy(desc(event.seq))
		.limit(options.limit)
		.then((rows) => rows.map(parseEventRow));
}
