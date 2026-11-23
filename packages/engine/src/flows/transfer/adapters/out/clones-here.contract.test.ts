import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { clone, device, project } from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { clonesHereContract } from "./clones-here.contract";
import { drizzleClonesHere } from "./drizzle-clones-here";
import { inMemoryClonesHere } from "./in-memory-clones-here";

/**
 * The contract of `ClonesHere`, on both adapters. The real side runs on
 * libsql in memory: a migrated database with the rows of the setup.
 */

clonesHereContract("in memory", async () => {
	const clones = inMemoryClonesHere();
	const spaceId = "space";
	const at = (id: string, projectId: string, repoPath: string) => ({
		id,
		projectId,
		spaceId,
		repoPath,
	});
	clones.add("laptop", at("first", "one", "/repos/one"));
	clones.add("laptop", at("second", "two", "/repos/two"));
	clones.add("laptop", at("gone", "three", "/repos/three"));
	clones.add("desktop", at("elsewhere", "one", "/repos/one"));
	clones.removeProject("three");
	return {
		clones,
		deviceId: "laptop",
		otherDeviceId: "desktop",
		spaceId,
		close: async () => {},
	};
});

clonesHereContract("drizzle, on libsql in memory", async () => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const deviceId = (await ownDevice(db)).id;
	const spaceId = await localSpaceId(db);
	await db
		.insert(device)
		.values({ id: "desktop", name: "Desktop", platform: "linux" });
	await db.insert(project).values([
		{ id: "one", spaceId, name: "one" },
		{ id: "two", spaceId, name: "two" },
		{ id: "three", spaceId, name: "three", removedAt: asDate(5) },
	]);
	const row = (
		id: string,
		projectId: string,
		owner: string,
		path: string,
		at: number,
	) => ({
		id,
		spaceId,
		projectId,
		deviceId: owner,
		path,
		createdAt: asDate(at),
	});
	await db
		.insert(clone)
		.values([
			row("second", "two", deviceId, "/repos/two", 2),
			row("first", "one", deviceId, "/repos/one", 1),
			row("gone", "three", deviceId, "/repos/three", 3),
			row("elsewhere", "one", "desktop", "/repos/one", 4),
		]);
	return {
		clones: drizzleClonesHere({ db }),
		deviceId,
		otherDeviceId: "desktop",
		spaceId,
		close: async () => {},
	};
});
