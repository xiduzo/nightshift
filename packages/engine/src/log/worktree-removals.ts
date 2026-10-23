import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { type LoggedEvent, parseEventRow } from "./events";

/** A `WorktreeRemoved` as logged. */
export type WorktreeRemoval = Extract<LoggedEvent, { type: "WorktreeRemoved" }>;

/** The project's `WorktreeRemoved` facts on this computer, oldest first. */
export async function worktreeRemovals(
	db: Database,
	projectId: string,
): Promise<WorktreeRemoval[]> {
	const rows = await db
		.select()
		.from(event)
		.where(
			and(
				eq(event.type, "WorktreeRemoved"),
				sql`json_extract(${event.payload}, '$.projectId') = ${projectId}`,
			),
		)
		.orderBy(asc(event.seq));
	return rows.map(parseEventRow) as WorktreeRemoval[];
}
