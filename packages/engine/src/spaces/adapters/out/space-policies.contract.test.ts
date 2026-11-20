import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { organization } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { createSpaceDocuments } from "../../../documents";
import { inMemorySpacePolicies } from "./in-memory-space-policies";
import { spacePoliciesContract } from "./space-policies.contract";
import { yjsSpacePolicies } from "./yjs-space-policies";

/**
 * The contract of `SpacePolicies`, on both adapters. The real adapter's
 * side runs on the Space documents over libsql in memory.
 */

spacePoliciesContract("in memory", async () => {
	const spacePolicies = inMemorySpacePolicies();
	spacePolicies.add("mine");
	spacePolicies.hostedElsewhere("hosted");
	return {
		spacePolicies,
		usageOf: async (spaceId) => spacePolicies.usageOf(spaceId),
		close: async () => {},
	};
});

spacePoliciesContract("over the Space documents", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	for (const id of ["mine", "hosted"]) {
		await db
			.insert(organization)
			.values({ id, name: id, slug: id, createdAt: asDate(0) });
	}
	const documents = createSpaceDocuments({
		db,
		directory: {
			names: async () => new Map(),
			hostedElsewhere: async (spaceId) => spaceId === "hosted",
		},
	});
	return {
		spacePolicies: yjsSpacePolicies(documents),
		async usageOf(spaceId) {
			const usage = (await documents.open(spaceId)).policy.get("usage");
			return typeof usage === "boolean" ? usage : undefined;
		},
		close: async () => {
			await documents.flush();
		},
	};
});
