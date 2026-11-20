import type { Database } from "@nightshift/db";
import { member, organization } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { and, asc, desc, eq } from "drizzle-orm";
import type { SpaceStore } from "../../application/ports";
import type { Role } from "../../roles";

/** `SpaceStore` over the organization plugin's tables. `wireSpaces` builds it. */
export function drizzleSpaceStore(db: Database): SpaceStore {
	return {
		async spacesOf(personId) {
			const rows = await db
				.select({
					id: organization.id,
					name: organization.name,
					personal: organization.personal,
					role: member.role,
				})
				.from(organization)
				.innerJoin(member, eq(member.organizationId, organization.id))
				.where(eq(member.userId, personId))
				.orderBy(desc(organization.personal), asc(organization.name));
			return rows.map((row) => ({ ...row, role: row.role as Role }));
		},
		async roleOf(personId, spaceId) {
			const [row] = await db
				.select({ role: member.role })
				.from(member)
				.where(
					and(eq(member.userId, personId), eq(member.organizationId, spaceId)),
				)
				.limit(1);
			return (row?.role as Role | undefined) ?? null;
		},
		async exists(spaceId) {
			const [row] = await db
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.id, spaceId));
			return row !== undefined;
		},
		async ids() {
			const rows = await db.select({ id: organization.id }).from(organization);
			return rows.map((row) => row.id);
		},
		async mirror(space) {
			await db
				.insert(organization)
				.values({
					id: space.id,
					name: space.name,
					slug: `host-${space.id}`,
					createdAt: asDate(),
				})
				.onConflictDoUpdate({
					target: organization.id,
					set: { name: space.name },
				});
		},
	};
}
