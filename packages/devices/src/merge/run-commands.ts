import type { Database } from "@nightshift/db";
import { runCommand } from "@nightshift/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { MergeMove } from "./personal-merge";

/**
 * The statements that move the commands of the moved runs (`run_command`)
 * to the Space their runs go to, for the batch that moves the runs: a
 * command never names a Space its run left. The Person who asked takes
 * their id in that Space (`personMap`), as the runs' `started_by` does.
 */
export function runCommandMoves(
	db: Database,
	moves: readonly MergeMove[],
	personMap: Readonly<Record<string, string>> = {},
): BatchItem<"sqlite">[] {
	const persons = Object.entries(personMap).filter(
		([local, there]) => local !== there,
	);
	return moves
		.filter((move) => move.runIds.length > 0)
		.map((move) =>
			db
				.update(runCommand)
				.set({
					spaceId: move.to,
					...(persons.length > 0
						? {
								personId: sql`case ${runCommand.personId} ${sql.join(
									persons.map(
										([local, there]) => sql`when ${local} then ${there}`,
									),
									sql` `,
								)} else ${runCommand.personId} end`,
							}
						: {}),
				})
				.where(
					and(
						eq(runCommand.spaceId, move.from),
						inArray(runCommand.runId, [...move.runIds]),
					),
				),
		);
}
