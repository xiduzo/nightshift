import { describe, expect, test } from "bun:test";
import { inMemoryHome, schedule } from "../adapters/out/in-memory-home";
import { mergeSteps } from "./merge-steps";
import { splitSteps } from "./split-steps";

/** What a leave pauses, and a join of the same Host turns on again, on in-memory adapters. */

/** Personal is merged with the Host's, and `p1` has these schedules, in step with the Host. */
function setUp(schedules = [schedule("on", { person: "ada-there" })]) {
	const { deps, world } = inMemoryHome();
	world.joined();
	world.schedules.set("p1", schedules);
	world.sync();
	const splits = splitSteps(deps);
	const merges = mergeSteps(deps);
	async function leave() {
		world.revoke();
		await splits.splitOff(null);
	}
	/** Joins the same Host again: the merge, then the documents. */
	async function rejoin() {
		world.hosts = world.hosts.map((h) => ({ ...h, revokedAt: null }));
		await merges.start({});
		world.sync();
	}
	return { deps, world, merges, leave, rejoin };
}

describe("a leave and a join of the same Host", () => {
	test("leave the schedules of the Host as they were", async () => {
		const before = [
			schedule("on", { person: "ada-there" }),
			schedule("off", { enabled: false, person: "ada-there" }),
		];
		const { world, leave, rejoin } = setUp(before);
		await leave();
		expect(world.schedules.get("p1")?.[0]).toEqual(
			schedule("on", { enabled: false }),
		);
		expect(world.record.splitsRows[0]?.paused).toEqual([
			{ projectId: "p1", schedule: before[0] as never },
		]);
		world.sync();
		expect(world.hostSchedules.get("p1")).toEqual(before);

		await rejoin();

		expect(world.hostSchedules.get("p1")).toEqual(before);
		expect(world.record.splitsRows[0]?.paused).toEqual([]);
	});

	test("a Person of this computer runs them as the Host knows that Person", async () => {
		const { world, leave, rejoin } = setUp([schedule("on", { person: "ada" })]);
		await leave();
		await rejoin();
		expect(world.hostSchedules.get("p1")).toEqual([
			schedule("on", { person: "ada-there" }),
		]);
	});

	test("what is kept before the pause stays kept when the split stops and goes on", async () => {
		const { deps, world, leave, rejoin } = setUp();
		world.batchFails = new Error("disk full");
		await expect(leave()).rejects.toThrow("disk full");
		world.batchFails = null;
		const row = world.record.splitsRows[0];
		if (!row) throw new Error("No split.");
		await splitSteps(deps).splitOff({ ...row });
		await rejoin();
		expect(world.hostSchedules.get("p1")).toEqual([
			schedule("on", { person: "ada-there" }),
		]);
	});

	test("one that a person turned on, then off, while apart stays off", async () => {
		const { world, leave, rejoin } = setUp();
		await leave();
		world.schedules.set("p1", [
			schedule("on", { enabled: false, person: "ada" }),
		]);
		await rejoin();
		expect(world.hostSchedules.get("p1")?.[0]?.enabled).toBe(false);
	});

	test("none is turned on in a Project that joined another one, or without a record", async () => {
		for (const how of ["other", "none"] as const) {
			const { world, leave, rejoin } = setUp();
			await leave();
			if (how === "none" && world.record.splitsRows[0]) {
				world.record.splitsRows[0].paused = null;
			}
			if (how === "other") {
				world.answer = () => ({
					spaceId: "theirs",
					projectMap: { p1: "there" },
					personMap: { ada: "ada-there" },
					elsewhere: [],
				});
			}
			const warn = console.warn;
			console.warn = () => {};
			await rejoin().finally(() => {
				console.warn = warn;
			});
			expect(world.schedules.get("p1")?.[0]?.enabled).toBe(false);
		}
	});
});
