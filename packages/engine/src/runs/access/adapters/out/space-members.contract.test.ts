import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { member, user } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { createSpaceDocuments, memberRole } from "../../../../projects";
import { aloneDirectory } from "../../../../testing/alone-directory";
import { otherSpace } from "../../../../testing/test-support";
import { authSpaceMembers } from "./auth-space-members";
import { inMemorySpaceMembers } from "./in-memory-space-members";
import { spaceMembersContract } from "./space-members.contract";

/**
 * The contract of `SpaceMembers`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with two Spaces, and their Space
 * documents, opened before any Member joins. So a `member` row a test
 * writes stays out of the document's mirror, and the doors can differ.
 */

spaceMembersContract("in memory", async () => {
	const members = inMemorySpaceMembers();
	return {
		members,
		space: { id: "space-platform", name: "Platform" },
		otherSpace: { id: "space-research", name: "Research" },
		join: async (spaceId, personId, role, where) =>
			members.join(spaceId, personId, role, where),
		close: async () => {},
	};
});

spaceMembersContract("over @nightshift/auth, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const platform = await otherSpace(db, "Platform");
	const research = await otherSpace(db, "Research");
	const documents = createSpaceDocuments({
		db,
		directory: aloneDirectory(db),
	});
	await documents.open(platform);
	await documents.open(research);
	let rows = 0;
	return {
		members: authSpaceMembers({
			db,
			documentRole: async (spaceId, personId) =>
				memberRole(await documents.open(spaceId), personId),
		}),
		space: { id: platform, name: "Platform" },
		otherSpace: { id: research, name: "Research" },
		async join(spaceId, personId, role, where = ["replica", "document"]) {
			if (where.includes("replica")) {
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
			}
			if (where.includes("document")) {
				// What the mirror of the Space's Members holds, as a Host sent it.
				const document = await documents.open(spaceId);
				document.members.set(personId, { name: personId, role });
			}
		},
		close: () => documents.flush(),
	};
});
