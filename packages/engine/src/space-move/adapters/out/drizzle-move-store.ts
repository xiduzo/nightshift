import { spaceExists } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { answerCost, event, project, run } from "@nightshift/db/schema";
import { and, eq, inArray, isNull, notExists, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { RowBatch } from "../../../contract";
import type { MoveStore } from "../../application/ports";
import { spaceMoveBatch } from "./drizzle-move-batch";

/**
 * The rows of a move over drizzle. `wireSpaceMove` builds it. The
 * statements that move the rows are `spaceMoveBatch`
 * (`drizzle-move-batch.ts`), and one `db.batch` runs them with the rows
 * of the packages above the engine and the caller's own.
 */
export function drizzleMoveStore(db: Database): MoveStore {
	return {
		async runIds(spaceId, projectIds, walkerId) {
			if (projectIds.length === 0) return [];
			const rows = await db
				.select({ id: run.id })
				.from(run)
				.where(
					and(
						eq(run.spaceId, spaceId),
						inArray(run.projectId, [...projectIds]),
						walkerId === undefined ? undefined : eq(run.walkerId, walkerId),
					),
				);
			return rows.map((row) => row.id);
		},

		async projectRows(ids) {
			if (ids.length === 0) return new Map();
			const rows = await db
				.select()
				.from(project)
				.where(inArray(project.id, [...ids]));
			return new Map(rows.map((row) => [row.id, row]));
		},

		async batchOf(move) {
			// The statements leave as the opaque batch the port names (G2).
			return (await spaceMoveBatch(db, move)) as unknown as RowBatch;
		},

		async commit(batches) {
			const [first, ...rest] = batches.flatMap(
				(batch) => batch as unknown as BatchItem<"sqlite">[],
			);
			if (first) await db.batch([first, ...rest]);
		},

		spaceExists(spaceId) {
			return spaceExists(db, spaceId);
		},

		async holdsRows(spaceId) {
			const [left] = await db
				.select({ id: project.id })
				.from(project)
				.where(eq(project.spaceId, spaceId))
				.union(
					db.select({ id: run.id }).from(run).where(eq(run.spaceId, spaceId)),
				)
				.limit(1);
			return left !== undefined;
		},

		async forgetRows(spaceId) {
			await db.delete(answerCost).where(eq(answerCost.spaceId, spaceId));
			await db
				.delete(event)
				.where(
					and(
						eq(event.spaceId, spaceId),
						or(
							isNull(event.runId),
							notExists(
								db
									.select({ id: run.id })
									.from(run)
									.where(eq(run.id, event.runId)),
							),
						),
					),
				);
		},
	};
}
