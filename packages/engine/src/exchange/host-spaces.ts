import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import {
	hostLink,
	hostSpace,
	member,
	organization,
} from "@nightshift/db/schema";
import { and, eq, inArray, notInArray } from "drizzle-orm";

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
 */

/** A Space as a Host lists it to a Device. */
export type ListedSpace = {
	id: string;
	name: string;
	personal: boolean;
	/** The role of the Device's owner there. */
	role: string;
};

export type HostSpaces = ReturnType<typeof createHostSpaces>;

export function createHostSpaces(db: Database) {
	return {
		/** Takes a Host's list as this Replica's copy, for its own Person. */
		async update(
			host: { id: string; name: string },
			spaces: readonly ListedSpace[],
			personId: string,
		): Promise<void> {
			const listed = spaces.map((s) => s.id);
			// No transaction: every write is an upsert, and it runs with each
			// answer of the Host, beside the walk's own writes.
			for (const space of spaces) {
				const [own] = await db
					.select({ id: organization.id })
					.from(organization)
					.where(eq(organization.id, space.id));
				const [kept] = await db
					.select()
					.from(hostSpace)
					.where(eq(hostSpace.spaceId, space.id));
				// A Space of this Replica's own is never taken for a Host's.
				if (own && !kept) continue;
				if (kept && kept.hostId !== host.id) continue;
				const name = space.personal ? `Personal on ${host.name}` : space.name;
				const [membership] = await db
					.select()
					.from(member)
					.where(
						and(
							eq(member.organizationId, space.id),
							eq(member.userId, personId),
						),
					);
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
				await db
					.insert(organization)
					.values({
						id: space.id,
						name,
						slug: `host-${space.id}`,
						createdAt: new Date(),
					})
					.onConflictDoUpdate({ target: organization.id, set: { name } });
				if (!membership) {
					await db.insert(member).values({
						id: randomUUID(),
						organizationId: space.id,
						userId: personId,
						role: space.role,
						createdAt: new Date(),
					});
				} else if (membership.role !== space.role) {
					await db
						.update(member)
						.set({ role: space.role })
						.where(eq(member.id, membership.id));
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
				await db
					.delete(member)
					.where(
						and(
							inArray(member.organizationId, goneIds),
							eq(member.userId, personId),
						),
					);
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
 * This computer's Person as the Host of a Space knows them (the Person of
 * its link), or null for a Space this Replica keeps itself. A run this
 * computer starts in a Host's Space names that Person, so every Replica of
 * the Space reads the same `started_by`.
 */
export async function personOnHost(
	db: Database,
	spaceId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ personId: hostLink.personId })
		.from(hostSpace)
		.innerJoin(hostLink, eq(hostLink.hostId, hostSpace.hostId))
		.where(eq(hostSpace.spaceId, spaceId));
	return row?.personId ?? null;
}
