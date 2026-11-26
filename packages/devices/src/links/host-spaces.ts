import { wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { hostLink, hostSpace } from "@nightshift/db/schema";
import { asDate, instantOrNull } from "@nightshift/time";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { ListedSpace } from "../contract";
import type { HostLink } from "./host-links";
import {
	type HostSpaceMembership,
	hostSpaceChanges,
} from "./host-spaces-changes";

/**
 * The Spaces this computer takes part in through its Hosts. A Host lists
 * them with every answer of the link: the Spaces its Device's owner is a
 * Member of there, with their role. This Replica keeps a copy of each
 * (`host_space`), and an `organization` row with a `member` row for its own
 * Person in that role: the Person who owns this computer acts here as its
 * owner on the Host, so sessions, the Space switcher and the role checks
 * work unchanged. A Space the Host stops listing loses that member row;
 * its rows stay, and its `host_space` row is marked left (`left_at`). A
 * left Space is no Host's here: every read below skips it. Only the Host
 * of its row brings it back.
 *
 * Such a Space is the Host's: this Replica never writes its document. It
 * changes it only through the Host's procedures.
 *
 * The one module that answers which Host keeps a Space (`hostOf`), this
 * computer's tie to that Host (`keeper`: its link, and whether it is
 * the home Host), and the Space's name here (`personalSpaceName` of
 * `@nightshift/auth` for a personal one). `host_space` is its own table:
 * nothing else writes it. What a list changes is the rule of
 * `hostSpaceChanges`: `update` reads the state once and applies them.
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
			const bound = wireSpaces({ db });
			// After a merge (ADR 1), the Person's personal Space here is the
			// Host's: it is named as their own.
			const ownPersonal = await bound.personal.findPersonalSpace({
				personId,
			});
			const own = new Set<string>();
			const memberships = new Map<string, HostSpaceMembership>();
			for (const space of spaces) {
				if (await bound.hasSpace({ spaceId: space.id })) own.add(space.id);
				const membership = await bound.members.findMembership({
					spaceId: space.id,
					personId,
				});
				if (membership) memberships.set(space.id, membership);
			}
			const kept = await db
				.select({
					spaceId: hostSpace.spaceId,
					hostId: hostSpace.hostId,
					name: hostSpace.name,
					role: hostSpace.role,
					personal: hostSpace.personal,
					leftAt: hostSpace.leftAt,
				})
				.from(hostSpace)
				.where(
					or(
						eq(hostSpace.hostId, host.id),
						inArray(
							hostSpace.spaceId,
							spaces.map((s) => s.id),
						),
					),
				);
			const changes = hostSpaceChanges({
				host,
				listed: spaces,
				kept: kept.map(({ leftAt, ...row }) => ({
					...row,
					left: leftAt !== null,
				})),
				own,
				memberships,
				ownPersonal,
			});
			// No transaction: every write is an upsert, and it runs with each
			// answer of the Host, beside the walk's own writes.
			for (const change of changes) {
				if (change.kind === "leave") {
					await bound.members.removeMemberships({
						spaceIds: change.spaceIds,
						personId,
					});
					// The row stays: it tells which Host may bring the Space back.
					await db
						.update(hostSpace)
						.set({ leftAt: asDate(), updatedAt: asDate() })
						.where(inArray(hostSpace.spaceId, change.spaceIds));
					continue;
				}
				const { spaceId, hostId, name, role, personal } = change.space;
				const row = { spaceId, hostId, name, role, personal, leftAt: null };
				await db
					.insert(hostSpace)
					.values(row)
					.onConflictDoUpdate({
						target: hostSpace.spaceId,
						set: { ...row, updatedAt: asDate() },
					});
				await bound.mirrorHostSpace({ id: spaceId, name });
				const { membership } = change;
				if (membership?.kind === "add") {
					await bound.members.addMembership({ spaceId, personId, role });
				} else if (membership?.kind === "role") {
					// A Space listed twice: the membership its first listing added.
					const membershipId =
						membership.membershipId ??
						(await bound.members.findMembership({ spaceId, personId }))?.id;
					if (membershipId) {
						await bound.members.setMembershipRole({ membershipId, role });
					}
				}
			}
		},

		/** The Host that keeps the Space, or null for a Space of this Replica's own. */
		async hostOf(spaceId: string): Promise<string | null> {
			const [row] = await db
				.select({ hostId: hostSpace.hostId })
				.from(hostSpace)
				.where(and(eq(hostSpace.spaceId, spaceId), isNull(hostSpace.leftAt)));
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
				.set({ name, updatedAt: asDate() })
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
				.where(and(eq(hostSpace.hostId, hostId), isNull(hostSpace.leftAt)))
				.orderBy(desc(hostSpace.personal), asc(hostSpace.name));
		},

		/** The Spaces this computer takes part in through the Host. */
		async ofHost(hostId: string): Promise<string[]> {
			const rows = await db
				.select({ spaceId: hostSpace.spaceId })
				.from(hostSpace)
				.where(and(eq(hostSpace.hostId, hostId), isNull(hostSpace.leftAt)));
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
export async function personInSpace<P extends string | null>(
	db: Database,
	spaceId: string,
	personId: P,
): Promise<string | P> {
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
		.where(and(eq(hostSpace.spaceId, spaceId), isNull(hostSpace.leftAt)));
	if (!row) return null;
	const { hostId, name, personId, role, revokedAt } = row;
	return {
		hostId,
		link:
			name !== null && personId !== null && role !== null
				? { name, personId, role, revokedAt: instantOrNull(revokedAt) }
				: null,
	};
}
