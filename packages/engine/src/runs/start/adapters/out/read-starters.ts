import type { Database } from "@nightshift/db";
import type { RunLog } from "../../../../log";
import { gitAuthorOf, namesOf, runFacts, toSummary } from "../../../../read";
import type { Starters } from "../../application/ports";

/** What the starters stand on: the Persons of this Replica, the run log, and this computer's name. */
export type ReadStartersDeps = {
	db: Database;
	log: Pick<RunLog, "state">;
	/** This computer's name: the Walker of the runs it starts. */
	selfName: string;
	/** The name of a Person as the Space document's Members name them. Default: none. */
	memberName?(spaceId: string, personId: string): Promise<string | null>;
};

/** Who starts a run, over the Persons of this Replica and the read model's summary of a run. */
export function readStarters(deps: ReadStartersDeps): Starters {
	const { db, log, selfName, memberName } = deps;
	return {
		gitAuthor: (personId) => gitAuthorOf(db, personId),
		async summary(row, device) {
			// This computer walks the run it started: the row names it.
			const walkerId = row.walkerId;
			return toSummary(
				row,
				runFacts(await log.state(row.id)),
				await namesOf(
					db,
					[row.startedBy],
					memberName && ((personId) => memberName(row.spaceId, personId)),
				),
				{ id: walkerId, name: selfName, thisDevice: true },
				{
					id: device.id,
					name: device.id === walkerId ? selfName : device.name,
					thisDevice: device.id === walkerId,
				},
			);
		},
	};
}
