import { expect, test } from "bun:test";
import { hostSpace, project, spaceSplit } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { pausedHere } from "./wire-peers-paused";

test("a schedule is paused per project, until a person ends it or a Host keeps the Space", async () => {
	const db = await migratedDb();
	const paused = ["p1", "p2"].map((projectId) => ({
		projectId,
		scheduleId: "night",
	}));
	const split = {
		fromSpace: "theirs",
		hostId: "host",
		hostName: "Studio",
		personId: "ada",
		hostPersonId: "ada-there",
		backup: "/b",
	};
	await db.insert(spaceSplit).values([
		{
			...split,
			toSpace: "own",
			state: "done",
			paused: JSON.stringify(paused),
		},
		{ ...split, toSpace: "before", state: "done" },
	]);
	await db
		.insert(project)
		.values(["p1", "p2", "p3"].map((id) => ({ id, spaceId: "own", name: id })));
	const here = pausedHere(db);
	expect([...(await here.of("p1"))]).toEqual(["night"]);
	expect([...(await here.of("p3"))]).toEqual([]);

	await here.ended("p1", ["night"]);
	expect([...(await here.of("p1"))]).toEqual([]);
	expect([...(await here.of("p2"))]).toEqual(["night"]);

	await db.insert(hostSpace).values({
		spaceId: "own",
		hostId: "host",
		name: "Personal",
		role: "owner",
		personal: true,
	});
	expect([...(await here.of("p2"))]).toEqual([]);
});
