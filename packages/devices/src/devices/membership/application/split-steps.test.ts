import { describe, expect, test } from "bun:test";
import { inMemoryHome, moving, schedule } from "../adapters/out/in-memory-home";
import { runInMemory } from "../adapters/out/in-memory-neighbours";
import { SPLIT_WORDS } from "../domain/words";
import { splitSteps } from "./split-steps";

/** The steps of a split, on in-memory adapters: Personal is merged with the Host's. */

function setUp(revoked = true) {
	const { deps, world } = inMemoryHome();
	world.joined();
	if (revoked) world.revoke();
	const steps = splitSteps(deps);
	const row = () => world.record.splitsRows[0] ?? null;
	return { deps, world, steps, row };
}

/** A merge into `toSpace` that is done: the Person is `person` there. */
async function merged(
	world: ReturnType<typeof setUp>["world"],
	toSpace: string,
	person: string,
) {
	const from = `before-${toSpace}`;
	const input = { fromSpace: from, hostId: "host", personId: "ada" };
	await world.record.merges.plan({ ...input, joined: [], backup: "/b" });
	await world.record.merges.mapped(from, {
		toSpace,
		projectMap: {},
		personMap: { ada: person },
	});
	await world.record.merges.pushed(from);
}

describe("who the rows are of after a split", () => {
	test("the Person of the link on the Host becomes this computer's own", async () => {
		const { world, steps } = setUp();
		await merged(world, "theirs", "ada-as-merged");

		await steps.splitOff(null);

		expect(world.plans[0]?.personMap).toEqual({ "ada-there": "ada" });
	});

	test("without the link, the Person of the merge into that Space", async () => {
		const { world, steps } = setUp();
		world.hosts = [];
		await merged(world, "theirs", "ada-as-merged");

		await steps.splitOff(null);

		expect(world.plans[0]?.personMap).toEqual({ "ada-as-merged": "ada" });
		expect(world.named).toEqual(["theirs: Personal on your old Host"]);
	});

	test("without either, the Person keeps their own id: never the Person of another Space's merge", async () => {
		const { world, steps } = setUp();
		world.hosts = [];
		await merged(world, "another", "somebody");

		await steps.splitOff(null);

		expect(world.plans[0]?.personMap).toEqual({ ada: "ada" });
	});
});

describe("what comes along", () => {
	test("a Project with a Clone, a run walked here, or no folder: every one, and no other", async () => {
		const { world, steps } = setUp();
		const only = (id: string, more: object) =>
			moving(id, { spaceId: "theirs", clone: false, ...more });
		world.projects = [
			only("cloned", { clone: true }),
			only("walked", { walked: true }),
			only("no-folder", { folder: false }),
			only("theirs-only", {}),
			only("other-space", { clone: true, spaceId: "team" }),
		];

		const result = await steps.splitOff(null);

		const to = (projectId: string) => ({ spaceId: "fresh", projectId });
		expect(world.plans[0]?.projects).toEqual({
			cloned: to("cloned"),
			walked: to("walked"),
			"no-folder": to("no-folder"),
		});
		expect(world.plans[0]?.ownRunsOnly).toBe(true);
		expect(result).toMatchObject({ state: "done", projects: 3 });
	});

	test("a schedule that is off stays as it is, one that is on pauses, and only that one counts", async () => {
		const { world, steps, row } = setUp();
		const off = schedule("off", { enabled: false, person: "ada-there" });
		world.schedules.set("p1", [
			off,
			schedule("on", { person: "ada-there", cron: "0 7 * * *" }),
		]);

		const result = await steps.splitOff(null);

		expect(world.schedules.get("p1")).toEqual([
			off,
			schedule("on", { enabled: false, cron: "0 7 * * *" }),
		]);
		expect(result?.unpinned).toBe(1);
		// The latest split of that Space says the same to a later ask.
		expect(await steps.of("theirs")).toEqual(result);
		expect(await steps.of("another")).toBeNull();
		expect(row()).toMatchObject({ hostId: "host", hostPersonId: "ada-there" });
	});

	test("the flows that wait for the Host merge before the batch that ends their merge, again after a stop", async () => {
		const { world, steps, row } = setUp();
		const waiting = { fromSpace: "own", hostId: "host", personId: "ada" };
		await world.record.merges.plan({ ...waiting, joined: [], backup: "/b" });
		await world.record.merges.mapped("own", {
			toSpace: "theirs",
			projectMap: {
				p1: { spaceId: "theirs", projectId: "p1" },
				old: { spaceId: "theirs", projectId: "new" },
				shared: { spaceId: "team", projectId: "team-project" },
			},
			personMap: { ada: "ada-there" },
		});
		runInMemory(world.record.merges.moved("own"));
		world.batchFails = new Error("disk full");
		await expect(steps.splitOff(null)).rejects.toThrow("disk full");
		const merged = [
			{ from: "old", to: "new", persons: {} },
			{ from: "shared", to: "team-project", persons: {} },
		];
		expect(world.merged).toEqual(merged);
		expect(world.record.mergesRows).toHaveLength(1);

		world.batchFails = null;
		await steps.splitOff(row());
		expect(world.merged).toEqual([...merged, ...merged]);
		expect(world.record.mergesRows).toEqual([]);
	});

	test("the flows of a merge that moved no row, or that is done, stay", async () => {
		for (const state of ["planned", "mapped", "pushed"] as const) {
			const { world, steps } = setUp();
			await merged(world, "theirs", "ada-there");
			const [merge] = world.record.mergesRows;
			if (!merge) throw new Error("No merge.");
			merge.state = state;
			merge.projectMap = { old: { spaceId: "theirs", projectId: "new" } };
			await steps.splitOff(null);
			expect(world.merged).toEqual([]);
		}
	});

	test("one batch makes the Space, names the Host's, ends a merge on its way and marks the split", async () => {
		const { world, steps, row } = setUp();
		const merge = { fromSpace: "own", hostId: "host", personId: "ada" };
		await world.record.merges.plan({ ...merge, joined: [], backup: "/b" });
		world.batchFails = new Error("disk full");

		await expect(steps.splitOff(null)).rejects.toThrow("disk full");
		expect(row()?.state).toBe("planned");
		expect(world.record.mergesRows).toHaveLength(1);
		expect(world.named).toEqual([]);
		expect(await world.personalSpaces.personalId("ada")).toBe("theirs");

		world.batchFails = null;
		expect(await steps.splitOff(row())).toMatchObject({ state: "done" });
		expect(world.personalSpaces.split).toEqual([
			{ personId: "ada", from: "theirs", to: "fresh", hostName: "Studio" },
		]);
		expect(world.named).toEqual(["theirs: Personal on Studio"]);
		expect(world.record.mergesRows).toEqual([]);
		// One copy of the database: what stopped does not make a second.
		expect(world.databaseCopy.copies).toEqual(["/tmp/before-leaving-host.db"]);
	});
});

describe("what holds a split", () => {
	test("a run that starts after the first check holds the rows back, under the hold of the move", async () => {
		const { world, steps, row } = setUp();
		world.underHold = async () =>
			world.run("late", { spaceId: "theirs", status: "running" });

		await expect(steps.splitOff(null)).rejects.toThrow(SPLIT_WORDS.notDone(1));
		expect(row()?.state).toBe("planned");
		expect(world.personalSpaces.split).toEqual([]);

		world.underHold = async () => {};
		world.runs = [];
		expect(await steps.splitOff(row())).toMatchObject({ state: "done" });
	});

	test("without a copy of the database, nothing starts", async () => {
		const { deps, world } = setUp();
		const steps = splitSteps({
			...deps,
			databaseCopy: { copy: () => Promise.reject(new Error("disk full")) },
		});

		await expect(steps.splitOff(null)).rejects.toThrow("disk full");
		expect(world.record.splitsRows).toEqual([]);
	});

	test("the check of a leave asks for runs only in a Personal that a Host keeps", async () => {
		const { world, steps } = setUp(false);
		const late = { status: "running" };
		world.run("r1", { spaceId: "theirs", ...late });
		await expect(steps.check()).rejects.toThrow(SPLIT_WORDS.notDone(1));
		world.runs = [];
		// A run that another computer walks stays with the Host.
		world.run("r2", { spaceId: "theirs", walker: "host", ...late });
		expect(await steps.check()).toBe("theirs");

		world.personalSpaces.setPersonalId("own");
		world.run("r3", late);
		expect(await steps.check()).toBeNull();
	});
});
