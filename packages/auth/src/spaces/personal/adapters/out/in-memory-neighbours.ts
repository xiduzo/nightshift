import { inMemoryLocalPersonStore } from "./in-memory-local-person-store";
import {
	inMemoryPersonalSpaceStore,
	personalRecords,
} from "./in-memory-personal-space-store";

/**
 * `inMemoryPersonalPorts`, which gives a use-case test every port of the
 * slice at once: both stores on the rows of one Replica, and the two
 * use cases of other slices it calls, which record what they were asked.
 * Test code: production code never imports this file.
 */

/** Every port of personal in memory at once: where each use-case test starts. */
export function inMemoryPersonalPorts() {
	const records = personalRecords();
	const claimed: string[] = [];
	let ids = 0;
	return {
		records,
		/** The Persons `claimHostAdmin` was asked for, in order. */
		claimed,
		newId: () => `id-${++ids}`,
		accountName: () => "ada",
		claimHostAdmin: async (request: { personId: string }) => {
			claimed.push(request.personId);
		},
		personalSpaceStore: inMemoryPersonalSpaceStore(records),
		localPersonStore: inMemoryLocalPersonStore(records),
	};
}
