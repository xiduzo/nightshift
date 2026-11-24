import type { Database } from "@nightshift/db";
import { drizzleSpaceStore } from "./adapters/out/drizzle-space-store";
import { findActiveSpace } from "./application/find-active-space";
import { mirrorHostSpace } from "./application/mirror-host-space";
import type { SpaceStore } from "./application/ports";
import { type Members, wireMembers } from "./members";
import { type Personal, wirePersonal } from "./personal";
import type { Role } from "./roles";

/**
 * The wiring of spaces: the one place that builds its real adapters and
 * binds each use case to its ports. It wires the sub-verticals `members`
 * and `personal` too, and hands each the use cases it needs of the other.
 */

/** What the package gives spaces: what the real adapters stand on. */
export type SpacesDeps = {
	db: Database;
};

/**
 * A Space as the organization plugin stores it (an organization), with the
 * role of the Person in it.
 */
export type Space = Awaited<ReturnType<SpaceStore["spacesOf"]>>[number];

/**
 * The use cases of spaces, bound to their ports, with those of its
 * sub-verticals, and the calls of a port that other slices make.
 */
export type Spaces = {
	members: Members;
	personal: Personal;
	/** The Spaces the Person is a member of, the personal one first, then by name. */
	listSpaces: (request: { personId: string }) => Promise<Space[]>;
	/** The Person's role in the Space, or null when they are not a member. */
	findRole: (request: {
		personId: string;
		spaceId: string;
	}) => Promise<Role | null>;
	/** The Space a session works in: its active Space when the Person is still a member of it, else their personal Space. */
	findActiveSpace: ReturnType<typeof findActiveSpace>;
	/** Whether a Space of that id exists on this Replica. */
	hasSpace: (request: { spaceId: string }) => Promise<boolean>;
	/** The id of every Space on this Replica. */
	listSpaceIds: () => Promise<string[]>;
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
		listSpaces: ({ personId }) => ports.spaceStore.spacesOf(personId),
		findRole: ({ personId, spaceId }) =>
			ports.spaceStore.roleOf(personId, spaceId),
		findActiveSpace: findActiveSpace(ports),
		hasSpace: ({ spaceId }) => ports.spaceStore.exists(spaceId),
		listSpaceIds: () => ports.spaceStore.ids(),
		mirrorHostSpace: mirrorHostSpace(ports),
	};
}
