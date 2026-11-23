import { randomUUID } from "node:crypto";
import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { device } from "@nightshift/db/schema";
import { HostUnreachableError, NIGHT_SHIFT } from "@nightshift/engine";
import { and, eq, isNull } from "drizzle-orm";
import { NotPairedError } from "../links";
import { drizzleMembershipRecord } from "./adapters/out/drizzle-membership-record";
import { fsDatabaseCopy } from "./adapters/out/fs-database-copy";
import {
	createHomeMembership,
	type HomeMembership,
	type HomeMembershipDeps as RingHomeMembershipDeps,
} from "./application/create-home-membership";
import type { MergeDeps } from "./application/merge-steps";
import type { SplitDeps } from "./application/split-steps";

/**
 * Old factory shape for tests: pass `db` and the engine pieces; the
 * ports are built here.
 */
export type LegacyHomeMembershipDeps = Omit<
	RingHomeMembershipDeps,
	| "record"
	| "personalSpaces"
	| "pairedDevices"
	| "databaseCopy"
	| "batches"
	| "wait"
	| "ids"
	| "engineKernel"
	| "isNotPaired"
> & {
	db: Database;
	wait?: MergeDeps["wait"];
	ids?: SplitDeps["ids"];
};

/** Builds HomeMembership the way the old factory did, for the suite. */
export function createHomeMembershipForTest(
	deps: LegacyHomeMembershipDeps,
): HomeMembership {
	const { db, wait, ids, ...rest } = deps;
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
		batches: {
			run: (batch) => db.batch(batch as Parameters<Database["batch"]>[0]),
		},
		wait: wait ?? {
			sleep: (ms) =>
				new Promise((resolve) => {
					const timer = setTimeout(resolve, ms);
					timer.unref?.();
				}),
		},
		ids: ids ?? { spaceId: () => randomUUID() },
		engineKernel: {
			nightShift: NIGHT_SHIFT,
			isHostUnreachable: (error) => error instanceof HostUnreachableError,
		},
		isNotPaired: (error) => error instanceof NotPairedError,
	});
}

export type HomeMembershipDeps = LegacyHomeMembershipDeps;

export { LEAVE_WORDS } from "./domain/words";
export { createHomeMembership, type HomeMembership };
