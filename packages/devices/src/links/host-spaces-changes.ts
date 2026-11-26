import { personalSpaceName } from "@nightshift/auth";
import type { ListedSpace } from "../contract";

/**
 * What a Host's list of Spaces means for this Replica: the rule of
 * `HostSpaces.update`, without the database. `update` reads the state
 * once, and applies the changes in their order.
 */

/** A Space as this Replica keeps it for a Host (a `host_space` row). */
export type KeptHostSpace = {
	spaceId: string;
	hostId: string;
	name: string;
	role: string;
	personal: boolean;
	/**
	 * This computer's Person left the Space: the Host stopped listing it.
	 * Only the Host of the row may bring it back.
	 */
	left: boolean;
};

/** The Host of a row this computer left before it kept which Host that was. */
export const UNKNOWN_HOST = "";

/** The membership of this computer's Person in a Space here. */
export type HostSpaceMembership = {
	/** Null for a membership that an earlier change of the same list adds. */
	id: string | null;
	role: string;
};

/** The state that one list of a Host is read against. */
export type HostSpaceState = {
	host: { id: string; name: string };
	/** The Spaces the Host lists, in its order. */
	listed: readonly ListedSpace[];
	/** The kept rows of the listed Spaces, and every kept row of this Host. */
	kept: readonly KeptHostSpace[];
	/** The listed Spaces that this Replica has a Space row for. */
	own: ReadonlySet<string>;
	/** The memberships of this computer's Person in the listed Spaces, by Space. */
	memberships: ReadonlyMap<string, HostSpaceMembership>;
	/** This computer's personal Space here, if any. */
	ownPersonal: string | null;
};

/** What a membership of a listed Space needs. */
export type MembershipChange =
	| { kind: "add"; role: string }
	| { kind: "role"; membershipId: string | null; role: string };

/** One change to this Replica's copy of a Host's Spaces. */
export type HostSpaceChange =
	| {
			/** Keep the listed Space as the Host's: its row, its name here, the membership. */
			kind: "take";
			space: KeptHostSpace;
			membership: MembershipChange | null;
	  }
	| {
			/** The Host no longer lists these Spaces: the membership ends, the rows stay, marked left. */
			kind: "leave";
			spaceIds: string[];
	  };

/**
 * The changes that a Host's list makes here, in order. A Space of this
 * Replica's own, or one another Host keeps or kept, is never taken. A
 * Space this computer left comes back through its own Host, or through
 * the first Host that lists it when that Host is not known. A personal
 * Space is "Personal" when it is this computer's own, else named after
 * its Host. A Space listed as before changes nothing. A Space of this
 * Host that the list leaves out loses the membership, and its row is
 * marked left.
 */
export function hostSpaceChanges(state: HostSpaceState): HostSpaceChange[] {
	const { host } = state;
	// The state as the changes before leave it, for a Space listed twice.
	const kept = new Map(state.kept.map((row) => [row.spaceId, row]));
	const memberships = new Map(state.memberships);
	const changes: HostSpaceChange[] = [];
	for (const listed of state.listed) {
		const row = kept.get(listed.id);
		if (state.own.has(listed.id) && !row) continue;
		if (row && !mayTake(row, host.id)) continue;
		const name = !listed.personal
			? listed.name
			: personalSpaceName(
					listed.id === state.ownPersonal ? undefined : host.name,
				);
		const membership = memberships.get(listed.id);
		if (
			row?.left === false &&
			row.name === name &&
			row.role === listed.role &&
			row.personal === listed.personal &&
			membership?.role === listed.role
		) {
			continue;
		}
		const space: KeptHostSpace = {
			spaceId: listed.id,
			hostId: host.id,
			name,
			role: listed.role,
			personal: listed.personal,
			left: false,
		};
		changes.push({
			kind: "take",
			space,
			membership: !membership
				? { kind: "add", role: listed.role }
				: membership.role !== listed.role
					? { kind: "role", membershipId: membership.id, role: listed.role }
					: null,
		});
		kept.set(listed.id, space);
		memberships.set(listed.id, {
			id: membership?.id ?? null,
			role: listed.role,
		});
	}
	const listedIds = new Set(state.listed.map((s) => s.id));
	const gone = state.kept
		.filter(
			(row) =>
				row.hostId === host.id && !row.left && !listedIds.has(row.spaceId),
		)
		.map((row) => row.spaceId);
	if (gone.length > 0) changes.push({ kind: "leave", spaceIds: gone });
	return changes;
}

/** Whether a Host may take a kept row: its own, or a left one whose Host is not known. */
function mayTake(row: KeptHostSpace, hostId: string): boolean {
	return row.hostId === hostId || (row.left && row.hostId === UNKNOWN_HOST);
}
