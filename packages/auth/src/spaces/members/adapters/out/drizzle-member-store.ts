import type { Database } from "@nightshift/db";
import { member, user } from "@nightshift/db/schema";
import { asDate, instant } from "@nightshift/time";
import { and, eq, inArray } from "drizzle-orm";
import type { Role } from "../../../roles";
import type { MemberStore } from "../../application/ports";

/** `MemberStore` over the organization plugin's `member` table. `wireMembers` builds it. */
export function drizzleMemberStore(db: Database): MemberStore {
	return {
		async membersOf(spaceId) {
			const rows = await db
				.select({
					id: member.id,
					personId: member.userId,
					name: user.name,
					email: user.email,
					role: member.role,
					joinedAt: member.createdAt,
				})
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(member.organizationId, spaceId))
				.orderBy(member.createdAt);
			return rows.map((row) => ({
				...row,
				role: row.role as Role,
				joinedAt: instant(row.joinedAt),
			}));
		},
		async roster(spaceId) {
			return await db
				.select({ id: user.id, name: user.name, role: member.role })
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(member.organizationId, spaceId));
		},
		async membershipOf(spaceId, personId) {
			const [row] = await db
				.select({ id: member.id, role: member.role })
				.from(member)
				.where(
					and(eq(member.organizationId, spaceId), eq(member.userId, personId)),
				);
			return row ?? null;
		},
		async add(membership) {
			await db.insert(member).values({
				id: membership.id,
				organizationId: membership.spaceId,
				userId: membership.personId,
				role: membership.role,
				createdAt: asDate(),
			});
		},
		async setRole(membershipId, role) {
			await db.update(member).set({ role }).where(eq(member.id, membershipId));
		},
		async remove(spaceIds, personId) {
			await db
				.delete(member)
				.where(
					and(
						inArray(member.organizationId, [...spaceIds]),
						eq(member.userId, personId),
					),
				);
		},
	};
}
