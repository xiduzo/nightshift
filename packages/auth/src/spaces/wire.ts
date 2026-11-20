import type { Database } from "@nightshift/db";
import { drizzleSpaceStore } from "./adapters/out/drizzle-space-store";
import { findActiveSpace } from "./application/find-active-space";
import { findRole } from "./application/find-role";
import { hasSpace } from "./application/has-space";
import { listSpaceIds } from "./application/list-space-ids";
import { listSpaces } from "./application/list-spaces";
import { mirrorHostSpace } from "./application/mirror-host-space";
import { type Members, wireMembers } from "./members";
import { type Personal, wirePersonal } from "./personal";

/**
 * The wiring of spaces: the one place that builds its real adapters and
 * binds each use case to its ports. It wires the sub-verticals `members`
 * and `personal` too, and hands each the use cases it needs of the other.
 */

/** What the package gives spaces: what the real adapters stand on. */
export type SpacesDeps = {
	db: Database;
};

/** The use cases of spaces, bound to their ports, with those of its sub-verticals. */
export type Spaces = {
	members: Members;
	personal: Personal;
	/** The Spaces the Person is a member of, the personal one first, then by name. */
	listSpaces: ReturnType<typeof listSpaces>;
	/** The Person's role in the Space, or null when they are not a member. */
	findRole: ReturnType<typeof findRole>;
	/** The Space a session works in: its active Space when the Person is still a member of it, else their personal Space. */
	findActiveSpace: ReturnType<typeof findActiveSpace>;
	/** Whether a Space of that id exists on this Replica. */
	hasSpace: ReturnType<typeof hasSpace>;
	/** The id of every Space on this Replica. */
	listSpaceIds: ReturnType<typeof listSpaceIds>;
	/** Keeps a Space that a Host lists as this Replica's copy. */
	mirrorHostSpace: ReturnType<typeof mirrorHostSpace>;
};

export function wireSpaces(deps: SpacesDeps): Spaces {
	const members = wireMembers({ db: deps.db });
	const personal = wirePersonal({
		db: deps.db,
		claimHostAdmin: members.claimHostAdmin,
	});
	const ports = {
		ensurePersonalSpace: personal.ensurePersonalSpace,
		spaceStore: drizzleSpaceStore(deps.db),
	};
	return {
		members,
		personal,
		listSpaces: listSpaces(ports),
		findRole: findRole(ports),
		findActiveSpace: findActiveSpace(ports),
		hasSpace: hasSpace(ports),
		listSpaceIds: listSpaceIds(ports),
		mirrorHostSpace: mirrorHostSpace(ports),
	};
}
