import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { member, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { otherSpace } from "../../../testing/test-support";
import { authMemberSpaces } from "./auth-member-spaces";
import { inMemoryMemberSpaces } from "./in-memory-member-spaces";
import { memberSpacesContract } from "./member-spaces.contract";

/**
 * The contract of `MemberSpaces`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with two Spaces.
 */

memberSpacesContract("in memory", async () => {
	const spaces = inMemoryMemberSpaces();
	spaces.space("space-platform", "Platform");
	spaces.space("space-research", "Research");
	return {
		spaces,
		space: { id: "space-platform", name: "Platform" },
		otherSpace: { id: "space-research", name: "Research" },
		join: async (spaceId, personId, role) =>
			spaces.join(spaceId, personId, role),
		close: async () => {},
	};
});

memberSpacesContract("over @nightshift/auth, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const platform = await otherSpace(db, "Platform");
	const research = await otherSpace(db, "Research");
	let rows = 0;
	return {
		spaces: authMemberSpaces({ db }),
		space: { id: platform, name: "Platform" },
		otherSpace: { id: research, name: "Research" },
		async join(spaceId, personId, role) {
			await db
				.insert(user)
				.values({
					id: personId,
					name: personId,
					email: `${personId}@x.invalid`,
				})
				.onConflictDoNothing();
			await db.insert(member).values({
				id: `member-${++rows}`,
				organizationId: spaceId,
				userId: personId,
				role,
				createdAt: asDate(),
			});
		},
		close: async () => {},
	};
});
