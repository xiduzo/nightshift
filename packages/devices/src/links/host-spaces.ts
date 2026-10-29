import {
	addMembership,
	membershipOf,
	mirrorHostSpace,
	personalSpaceId,
	personalSpaceName,
	removeMemberships,
	setMembershipRole,
	spaceExists,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { hostLink, hostSpace } from "@nightshift/db/schema";
import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { ListedSpace } from "../contract";
import type { HostLink } from "./host-links";

/**
 * The Spaces this computer takes part in through its Hosts. A Host lists
 * them with every answer of the link: the Spaces its Device's owner is a
 * Member of there, with their role. This Replica keeps a copy of each
 * (`host_space`), and an `organization` row with a `member` row for its own
 * Person in that role: the Person who owns this computer acts here as its
 * owner on the Host, so sessions, the Space switcher and the role checks
 * work unchanged. A Space the Host stops listing loses that member row;
 * its rows stay.
 *
 * Such a Space is the Host's: this Replica never writes its document. It
 * changes it only through the Host's procedures.
 *
 * The one module that answers which Host keeps a Space (`hostOf`), this
 * computer's tie to that Host (`keeper`: its link, and whether it is
 * the home Host), and the Space's name here (`personalSpaceName` of
 * `@nightshift/auth` for a personal one). `host_space` is its own table:
 * nothing else writes it.
 */

export type HostSpaces = ReturnType<typeof createHostSpaces>;

/** A Space a Host keeps, as this computer lists it. */
export type HostSpaceRef = { id: string; name: string; personal: boolean };

/**
 * The Host that keeps a Space, and this computer's link to it: the
 * Host's name, the Person of this computer there, its role and whether
 * the Host removed its access. No link: a new home Host replaced it.
 */
export type SpaceKeeper = {
	hostId: string;
	link: Pick<HostLink, "name" | "personId" | "role" | "revokedAt"> | null;
};

export function createHostSpaces(db: Database) {
	return {
		/** Takes a Host's list as this Replica's copy, for its own Person. */
		async update(
			host: { id: string; name: string },
			spaces: readonly ListedSpace[],
			personId: string,
		): Promise<void> {
			const listed = spaces.map((s) => s.id);
			// After a merge (ADR 1), the Person's personal Space here is the
			// Host's: it is named as their own.
			const ownPersonal = await personalSpaceId(db, personId);
			// No transaction: every write is an upsert, and it runs with each
			// answer of the Host, beside the walk's own writes.
			for (const space of spaces) {
				const own = await spaceExists(db, space.id);
				const [kept] = await db
					.select()
					.from(hostSpace)
					.where(eq(hostSpace.spaceId, space.id));
				// A Space of this Replica's own is never taken for a Host's.
				if (own && !kept) continue;
				if (kept && kept.hostId !== host.id) continue;
				const name = !space.personal
					? space.name
					: personalSpaceName(space.id === ownPersonal ? undefined : host.name);
				const membership = await membershipOf(db, space.id, personId);
				if (
					kept?.name === name &&
					kept.role === space.role &&
					kept.personal === space.personal &&
					membership?.role === space.role
				) {
					continue;
				}
				await db
					.insert(hostSpace)
					.values({
						spaceId: space.id,
						hostId: host.id,
						name,
						role: space.role,
						personal: space.personal,
					})
					.onConflictDoUpdate({
						target: hostSpace.spaceId,
						set: {
							name,
							role: space.role,
							personal: space.personal,
							updatedAt: new Date(),
						},
					});
				await mirrorHostSpace(db, { id: space.id, name });
				if (!membership) {
					await addMembership(db, {
						spaceId: space.id,
						personId,
						role: space.role,
					});
				} else if (membership.role !== space.role) {
					await setMembershipRole(db, membership.id, space.role);
				}
			}
			const gone = await db
				.select({ spaceId: hostSpace.spaceId })
				.from(hostSpace)
				.where(
					and(
						eq(hostSpace.hostId, host.id),
						listed.length > 0
							? notInArray(hostSpace.spaceId, listed)
							: undefined,
					),
				);
			const goneIds = gone.map((g) => g.spaceId);
			if (goneIds.length > 0) {
				await removeMemberships(db, goneIds, personId);
				await db.delete(hostSpace).where(inArray(hostSpace.spaceId, goneIds));
			}
		},

		/** The Host that keeps the Space, or null for a Space of this Replica's own. */
		async hostOf(spaceId: string): Promise<string | null> {
			const [row] = await db
				.select({ hostId: hostSpace.hostId })
				.from(hostSpace)
				.where(eq(hostSpace.spaceId, spaceId));
			return row?.hostId ?? null;
		},

		/** The Host that keeps the Space and this computer's link to it, or null for a Space of this Replica's own. */
		keeper: (spaceId: string) => keeperOf(db, spaceId),

		/**
		 * The statement that gives a Space a Host keeps its name here, for
		 * the batch of a split: the Host's Space stays, as "Personal on
		 * <Host>".
		 */
		named(spaceId: string, name: string): BatchItem<"sqlite"> {
			return db
				.update(hostSpace)
				.set({ name, updatedAt: new Date() })
				.where(eq(hostSpace.spaceId, spaceId));
		},

		/** The Spaces this computer takes part in through the Host, by name. */
		async listed(hostId: string): Promise<HostSpaceRef[]> {
			return db
				.select({
					id: hostSpace.spaceId,
					name: hostSpace.name,
					personal: hostSpace.personal,
				})
				.from(hostSpace)
				.where(eq(hostSpace.hostId, hostId))
				.orderBy(desc(hostSpace.personal), asc(hostSpace.name));
		},

		/** The Spaces this computer takes part in through the Host. */
		async ofHost(hostId: string): Promise<string[]> {
			const rows = await db
				.select({ spaceId: hostSpace.spaceId })
				.from(hostSpace)
				.where(eq(hostSpace.hostId, hostId));
			return rows.map((r) => r.spaceId);
		},
	};
}

/**
 * A Person of this computer as the Space knows them: in a Space a Host
 * keeps, the Person of this computer's link to that Host (this computer
 * has one Person there, whoever asks here); in a Space of this Replica's
 * own, the Person as is. A run this computer starts in a Host's Space
 * names that Person, so every Replica of the Space reads the same
 * `started_by`.
 */
export async function personInSpace(
	db: Database,
	spaceId: string,
	personId: string,
): Promise<string>;
export async function personInSpace(
	db: Database,
	spaceId: string,
	personId: string | null,
): Promise<string | null>;
export async function personInSpace(
	db: Database,
	spaceId: string,
	personId: string | null,
): Promise<string | null> {
	return (await personOnHost(db, spaceId)) ?? personId;
}

/**
 * This computer's Person as the Host of a Space knows them (the Person of
 * its link), or null for a Space this Replica keeps itself.
 */
export async function personOnHost(
	db: Database,
	spaceId: string,
): Promise<string | null> {
	return (await keeperOf(db, spaceId))?.link?.personId ?? null;
}

/**
 * Whether this computer's home Host keeps the Space: there, this
 * computer's Person may place steps on their other Devices.
 */
export async function keptByHomeHost(
	db: Database,
	spaceId: string,
): Promise<boolean> {
	return (await keeperOf(db, spaceId))?.link?.role === "home";
}

/** The Host that keeps the Space and this computer's link to it, or null for a Space of this Replica's own. */
async function keeperOf(
	db: Database,
	spaceId: string,
): Promise<SpaceKeeper | null> {
	const [row] = await db
		.select({
			hostId: hostSpace.hostId,
			name: hostLink.name,
			personId: hostLink.personId,
			role: hostLink.role,
			revokedAt: hostLink.revokedAt,
		})
		.from(hostSpace)
		.leftJoin(hostLink, eq(hostLink.hostId, hostSpace.hostId))
		.where(eq(hostSpace.spaceId, spaceId));
	if (!row) return null;
	const { hostId, name, personId, role, revokedAt } = row;
	return {
		hostId,
		link:
			name !== null && personId !== null && role !== null
				? { name, personId, role, revokedAt: revokedAt?.getTime() ?? null }
				: null,
	};
}
