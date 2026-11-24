import { member, organization, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { memoryDb } from "../testing/memory-db";
import { drizzleSpaceStore } from "./adapters/out/drizzle-space-store";

/**
 * Every port of spaces over a database in memory, and the use case of
 * personal it calls, which records whom it was asked for: where each
 * use-case test starts.
 */
export async function spacesPorts() {
	const db = await memoryDb();
	const ensured: string[] = [];
	return {
		/** The Persons `ensurePersonalSpace` was asked for, in order. */
		ensured,
		ensurePersonalSpace: async (request: { personId: string }) => {
			ensured.push(request.personId);
			return `personal-of-${request.personId}`;
		},
		spaceStore: drizzleSpaceStore(db),
		/** Makes the Person, the Space and the membership. */
		async join(spaceId: string, personId: string, role: string) {
			const email = `${personId}@x.org`;
			await db.insert(user).values({ id: personId, name: personId, email });
			await db.insert(organization).values({
				id: spaceId,
				name: spaceId,
				slug: spaceId,
				createdAt: asDate(0),
			});
			await db.insert(member).values({
				id: `${personId}@${spaceId}`,
				organizationId: spaceId,
				userId: personId,
				role,
				createdAt: asDate(0),
			});
		},
		/** The Spaces, as a test compares them. */
		spaces: () =>
			db
				.select({
					id: organization.id,
					name: organization.name,
					slug: organization.slug,
					personal: organization.personal,
				})
				.from(organization),
	};
}
