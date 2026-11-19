import type { Database } from "@nightshift/db";
import { member, organization, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { and, eq } from "drizzle-orm";

/**
 * Makes the Person a Member of the Space in this database, with `role`
 * (default `member`): the rows a Replica has for a Member who signed up
 * and joined. It adds the Person and the Space when the database lacks
 * them, as a Device that never met them lacks them. A Member keeps the
 * role they have. A test of a whole engine that acts as a Person calls it
 * first: the engine checks the Person's role in the Space.
 */
export async function joinSpace(
	db: Database,
	spaceId: string,
	personId: string,
	role = "member",
): Promise<void> {
	await db
		.insert(user)
		.values({
			id: personId,
			name: personId,
			email: `${personId}@members.test`,
		})
		.onConflictDoNothing();
	await db
		.insert(organization)
		.values({ id: spaceId, name: spaceId, slug: spaceId, createdAt: asDate() })
		.onConflictDoNothing();
	const [joined] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, spaceId), eq(member.userId, personId)))
		.limit(1);
	if (joined) return;
	await db.insert(member).values({
		id: `member-${spaceId}-${personId}`,
		organizationId: spaceId,
		userId: personId,
		role,
		createdAt: asDate(),
	});
}
