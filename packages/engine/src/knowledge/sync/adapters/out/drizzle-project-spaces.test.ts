import { beforeEach, describe, expect, test } from "bun:test";
import { organization, project } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleProjectSpaces } from "./drizzle-project-spaces";

const make = async () => {
	const db = await migratedDb();
	await db.insert(organization).values([
		{ id: "s1", name: "s1", slug: "s1", createdAt: asDate(0) },
		{ id: "s2", name: "s2", slug: "s2", createdAt: asDate(0), personal: true },
	]);
	await db.insert(project).values([
		{ id: "p1", spaceId: "s1", name: "p1" },
		{ id: "p2", spaceId: "s1", name: "p2", removedAt: asDate(0) },
		{ id: "p3", spaceId: "s2", name: "p3" },
	]);
	return { projectSpaces: drizzleProjectSpaces(db) };
};

describe("ProjectSpaces over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
	beforeEach(async () => {
		under = await make();
	});

	test("the Space of a project, and null for one this Replica does not have", async () => {
		expect(await under.projectSpaces.spaceOf("p1")).toBe("s1");
		expect(await under.projectSpaces.spaceOf("nobody-has-it")).toBeNull();
	});

	test("a Space is shared unless it is personal, and an unknown one is not", async () => {
		expect(await under.projectSpaces.isShared("s1")).toBe(true);
		expect(await under.projectSpaces.isShared("s2")).toBe(false);
		expect(await under.projectSpaces.isShared("nobody-has-it")).toBe(false);
	});

	test("the projects of a Space", async () => {
		expect((await under.projectSpaces.projectsIn("s1")).sort()).toEqual([
			"p1",
			"p2",
		]);
		expect(await under.projectSpaces.projectsIn("s3")).toEqual([]);
	});
});
