import { inMemoryInvitationStore } from "./in-memory-invitation-store";
import { inMemoryMemberStore } from "./in-memory-member-store";
import {
	inMemoryPersonStore,
	membersRecords,
	seedRecords,
} from "./in-memory-person-store";

/**
 * `inMemoryMembersPorts`, which gives a use-case test every port of the
 * slice at once: the three stores on the rows of one Replica. Test code:
 * production code never imports this file.
 */

/** Every port of members in memory at once: where each use-case test starts. */
export function inMemoryMembersPorts() {
	const records = membersRecords();
	let ids = 0;
	return {
		records,
		seed: seedRecords(records),
		newId: () => `id-${++ids}`,
		personStore: inMemoryPersonStore(records),
		invitationStore: inMemoryInvitationStore(records),
		memberStore: inMemoryMemberStore(records),
	};
}
