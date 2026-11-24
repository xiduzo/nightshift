import { randomUUID } from "node:crypto";
import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import { HostUnreachableError, NIGHT_SHIFT } from "@nightshift/engine";
import { and, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { NotPairedError } from "../../links";
import { drizzleMembershipRecord } from "./adapters/out/drizzle-membership-record";
import { fsDatabaseCopy } from "./adapters/out/fs-database-copy";
import {
	createHomeMembership,
	type HomeMembership,
	type HomeMembershipDeps,
} from "./application/create-home-membership";
import type { Batches } from "./application/ports";

/**
 * What a suite gives the membership: the database and the engine pieces.
 * The ports are filled here as `wireMembership` fills them. The suites do
 * not use `wireMembership`: it takes no waits (`syncWaitMs`, `pollMs`) and
 * goes on with what stopped by itself.
 */
export type MembershipTestDeps = Omit<
	HomeMembershipDeps,
	| "record"
	| "personalSpaces"
	| "pairedDevices"
	| "databaseCopy"
	| "batches"
	| "wait"
	| "ids"
	| "engineKernel"
	| "isNotPaired"
> & { db: Database };

function batchesOf(db: Database): Batches {
	return {
		async run(batch) {
			// The adapter that runs an opaque batch reads it back (`RowBatch`).
			const [first, ...rest] = batch as unknown as BatchItem<"sqlite">[];
			if (first) await db.batch([first, ...rest]);
		},
	};
}

/** The membership of this computer over `db`, with the waits of the test. */
export function membershipOver(deps: MembershipTestDeps): HomeMembership {
	const { db, ...rest } = deps;
	const spaces = wireSpaces({ db });
	return createHomeMembership({
		...rest,
		record: drizzleMembershipRecord(db),
		personalSpaces: {
			personalId: (personId) => spaces.personal.findPersonalSpace({ personId }),
			exists: (spaceId) => spaces.hasSpace({ spaceId }),
			adoptBatch: async (input) =>
				(await spaces.personal.adoptPersonalSpace(input)) as never,
			splitBatch: async (input) =>
				(await spaces.personal.splitPersonalSpace(input)) as never,
		},
		pairedDevices: {
			async hasPaired() {
				const [paired] = await db
					.select({ id: device.id })
					.from(device)
					.where(and(eq(device.self, false), isNull(device.revokedAt)))
					.limit(1);
				return paired !== undefined;
			},
		},
		databaseCopy: fsDatabaseCopy(db),
		batches: batchesOf(db),
		wait: {
			sleep: (ms) =>
				new Promise((resolve) => {
					const timer = setTimeout(resolve, ms);
					timer.unref?.();
				}),
		},
		ids: { spaceId: () => randomUUID() },
		engineKernel: {
			nightShift: NIGHT_SHIFT,
			isHostUnreachable: (error) => error instanceof HostUnreachableError,
		},
		isNotPaired: (error) => error instanceof NotPairedError,
	});
}
