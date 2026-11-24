import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { HostDown, moving, schedule } from "../adapters/out/in-memory-home";
import { MERGE_WORDS } from "../domain/words";
import { home } from "../test-support";
import { mergeSteps } from "./merge-steps";

/** The steps of a merge, with the record over a database in memory. */

async function setUp() {
	const { deps, world } = await home();
	const steps = mergeSteps(deps);
	const state = async () => (await world.merges())[0]?.state ?? null;
	/** Goes on with the merge its row says. */
	async function goOn() {
		const row = await world.record.merges.latest();
		if (!row) throw new Error("No merge started.");
		return steps.resume(row);
	}
	return { deps, world, steps, state, goOn };
}

/** The Host's answer: where each Project goes, and the shared ones. */
const answers =
	(
		projectMap: Record<string, string>,
		elsewhere: { projectId: string; joined: boolean }[] = [],
	) =>
	() => ({
		spaceId: "theirs",
		projectMap,
		personMap: { ada: "ada-there" },
		elsewhere: elsewhere.map((e) => ({
			...e,
			name: e.projectId,
			remote: "r",
			spaceId: "team",
			spaceName: "Team",
			hostProjectId: "there",
		})),
	});

describe("what holds a merge", () => {
	test("a Host that does not list a personal Space yet", async () => {
		const { world, steps } = await setUp();
		world.listed = [{ id: "team", name: "Team", personal: false }];

		await expect(steps.start({})).rejects.toThrow(MERGE_WORDS.notListed);
		expect(await world.merges()).toEqual([]);
		expect(world.databaseCopy.copies).toEqual([]);
	});

	for (const status of ["running", "waiting", "sleeping"]) {
		test(`a run that is ${status}, before the copy of the database and the ask`, async () => {
			const { world, steps } = await setUp();
			world.run("r1", { status });

			await expect(steps.start({})).rejects.toThrow("is not done yet");
			expect(world.databaseCopy.copies).toEqual([]);
			expect(world.asked).toEqual([]);
		});
	}

	test("a run that starts after the first check holds the rows back, under the hold of the move", async () => {
		const { world, steps, state, goOn } = await setUp();
		world.underHold = async () => world.run("late", { status: "running" });

		await expect(steps.start({})).rejects.toThrow(
			"A run in Personal is not done yet.",
		);
		expect(await state()).toBe("mapped");
		expect(world.personalSpaces.adopted).toEqual([]);
		expect(world.runs[0]?.spaceId).toBe("own");

		world.underHold = async () => {};
		world.runs = [];
		expect(await goOn()).toMatchObject({ state: "pushed" });
	});

	test("a planned merge checks its own Host and runs again before it asks", async () => {
		const { world, steps, state, goOn } = await setUp();
		world.callFails = new HostDown();
		await expect(steps.start({})).rejects.toThrow(MERGE_WORDS.offline);
		world.callFails = null;
		world.run("r1", { status: "waiting" });

		await expect(goOn()).rejects.toThrow("is not done yet");
		world.runs = [];
		world.online.delete("host");
		await expect(goOn()).rejects.toThrow(MERGE_WORDS.offline);
		expect(world.asked).toEqual([]);
		expect(await state()).toBe("planned");

		// What holds a new merge does not hold one that started.
		world.online.add("host");
		world.pairedDevices.setHasPaired(true);
		expect(await goOn()).toMatchObject({ state: "pushed" });
	});
});

describe("the ask of the Host", () => {
	test("says what each Project is, who asks and which shared Projects the Person chose, and nothing more", async () => {
		const { world, steps } = await setUp();
		world.projects = [
			moving("p1", { remote: "r1", walked: true, createdAt: 3 }),
			moving("p2", { clone: false, folder: false, removedAt: 7 }),
			moving("team-own", { spaceId: "elsewhere" }),
		];

		await steps.start({ join: ["p1"] });

		const project = { name: "p1", remote: "r1", createdAt: 3, removedAt: null };
		expect(world.asked).toEqual([
			{
				personId: "ada",
				projects: [
					{ id: "p1", ...project, clone: true, folder: true },
					{
						id: "p2",
						name: "p2",
						remote: null,
						createdAt: 10,
						removedAt: 7,
						clone: false,
						folder: false,
					},
				],
				join: ["p1"],
				dryRun: false,
			},
		]);
	});

	test("a merge that goes on asks for the same shared Projects as it did before", async () => {
		const { world, steps, goOn } = await setUp();
		world.callFails = new HostDown();
		await expect(steps.start({ join: ["p1"] })).rejects.toThrow();
		world.callFails = null;

		await goOn();

		expect(world.asked.map((ask) => ask.join)).toEqual([["p1"]]);
	});

	test("a Host that does not answer says so, and the merge waits as planned", async () => {
		const { world, steps, state } = await setUp();
		world.callFails = new HostDown("secret address");

		const asked = steps.start({});

		await expect(asked).rejects.toBeInstanceOf(Refusal);
		await expect(asked).rejects.toThrow(MERGE_WORDS.offline);
		expect(await state()).toBe("planned");
	});

	test("an answer for another Space than the one it lists moves nothing", async () => {
		const { world, steps, state } = await setUp();
		world.answer = () => ({ ...answers({ p1: "p1" })(), spaceId: "not-mine" });

		await expect(steps.start({})).rejects.toThrow("not-mine");
		expect(await state()).toBe("planned");
		expect(world.plans).toEqual([]);
	});

	test("without a copy of the database, nothing starts", async () => {
		const { deps, world } = await setUp();
		const steps = mergeSteps({
			...deps,
			databaseCopy: { copy: () => Promise.reject(new Error("disk full")) },
		});

		await expect(steps.start({})).rejects.toThrow("disk full");
		expect(await world.merges()).toEqual([]);
		expect(world.asked).toEqual([]);
	});
});

describe("where the Projects go", () => {
	test("only a Project the Person chose goes to the shared Space: one that stays apart goes to Personal", async () => {
		const { world, steps } = await setUp();
		world.projects = [moving("p1"), moving("p2"), moving("p3")];
		world.answer = answers({ p1: "there", p2: "p2", p3: "p3" }, [
			{ projectId: "p1", joined: true },
			{ projectId: "p2", joined: false },
		]);

		await steps.start({ join: ["p1"] });

		expect(world.plans[0]).toEqual({
			projects: {
				p1: { spaceId: "team", projectId: "there" },
				p2: { spaceId: "theirs", projectId: "p2" },
				p3: { spaceId: "theirs", projectId: "p3" },
			},
			personMap: { ada: "ada-there" },
			renumber: true,
			empties: true,
			schedule: expect.any(Function),
		} as never);
		expect(world.personalSpaces.adopted).toEqual([
			{ personId: "ada", from: "own", to: "theirs" },
		]);
		// The Host has the runs of both Spaces before the merge is done.
		expect(world.pushedAsked).toEqual([["host", ["team", "theirs"], "me"]]);
	});

	test("the preview says it per Project, with the schedules of those that fire", async () => {
		const { world, steps } = await setUp();
		world.projects = [
			moving("p1"),
			moving("p2"),
			moving("p3", { removedAt: 5 }),
		];
		for (const id of ["p1", "p3"]) world.schedules.set(id, [schedule("s")]);
		world.run("r1");
		world.run("r2", { projectId: "p2" });
		world.answer = answers({ p1: "there", p2: "p2", p3: "p3" }, [
			{ projectId: "p1", joined: true },
			{ projectId: "p2", joined: false },
		]);

		const { projects, runs } = await steps.preview({ join: ["p1"] });

		const team = { id: "team", name: "Team" };
		expect(
			projects.map((p) => [p.id, p.into, p.sharedSpace, p.runs, p.schedules]),
		).toEqual([
			["p1", "shared", team, 1, 1],
			["p2", "apart", team, 1, 0],
			["p3", "new", null, 0, 0],
		]);
		expect(projects.map((p) => p.removed)).toEqual([false, false, true]);
		expect(runs).toBe(2);
		expect(world.planned).toEqual([["p1", "there", { ada: "ada-there" }]]);
		expect(world.asked.map((a) => [a.dryRun, a.join])).toEqual([
			[true, ["p1"]],
		]);
	});
});

describe("Projects that change on the way", () => {
	test("the Host is asked again only when they are not those it answered for, and what stopped goes on", async () => {
		const { world, steps, state, goOn } = await setUp();
		world.batchFails = new Error("disk full");
		await expect(steps.start({})).rejects.toThrow("disk full");
		await expect(goOn()).rejects.toThrow("disk full");
		expect(world.asked).toHaveLength(1);

		world.projects.push(moving("late", { clone: false }));
		await expect(goOn()).rejects.toThrow("disk full");
		expect(world.asked).toHaveLength(2);
		// The second answer is kept: a stop here asks no third time.
		world.batchFails = null;
		expect(await goOn()).toMatchObject({ state: "pushed", projects: 2 });
		expect(world.asked).toHaveLength(2);
		expect(await state()).toBe("pushed");
		expect(world.projects.map((p) => p.spaceId)).toEqual(["theirs", "theirs"]);
	});

	test("one that takes the place of another is asked for too", async () => {
		const { world, steps, goOn } = await setUp();
		world.projects = [moving("p1"), moving("p2")];
		world.batchFails = new Error("disk full");
		await expect(steps.start({})).rejects.toThrow("disk full");
		world.batchFails = null;
		world.projects = [
			moving("p1"),
			moving("p2", { spaceId: "other" }),
			moving("p3"),
		];
		expect(await goOn()).toMatchObject({ state: "pushed", projects: 2 });
		expect(world.projects.map((p) => p.spaceId)).toEqual([
			"theirs",
			"other",
			"theirs",
		]);
	});

	test("one that comes under the hold each time ends the merge, and no row moves", async () => {
		const { world, steps, state } = await setUp();
		let next = 0;
		world.underHold = async () => {
			world.projects.push(moving(`late-${++next}`));
		};
		await expect(steps.start({})).rejects.toThrow(MERGE_WORDS.changed);
		expect(world.asked).toHaveLength(3);
		expect(await state()).toBe("mapped");
		expect(new Set(world.projects.map((p) => p.spaceId))).toEqual(
			new Set(["own"]),
		);

		world.underHold = async () => {};
		const row = await world.record.merges.latest();
		if (!row) throw new Error("No merge.");
		expect(await steps.resume(row)).toMatchObject({ state: "pushed" });
	});
});

describe("the schedules that a leave paused here", () => {
	const left = async (
		world: Awaited<ReturnType<typeof setUp>>["world"],
		more: Partial<{ hostId: string; hostPersonId: string; fromSpace: string }>,
	) => {
		await world.record.splits.plan({
			toSpace: "own",
			fromSpace: "theirs",
			hostId: "host",
			hostName: "Studio",
			personId: "ada",
			hostPersonId: "ada-there",
			backup: "/b",
			...more,
		});
		await world.runBatch(
			world.record.splits.moved("own", {
				projects: ["p1"],
				runs: 0,
				unpinned: 1,
				paused: [{ projectId: "p1", scheduleId: "on" }],
				waiting: {},
			}),
		);
		await world.record.splits.done("own");
		world.schedules.set("p1", [
			schedule("on", { person: "ada-there" }),
			schedule("new"),
		]);
	};

	test("go to the Host they came from as they are", async () => {
		const { world, steps } = await setUp();
		await left(world, {});
		await steps.start({});
		expect(world.schedules.get("p1")).toEqual([
			schedule("on", { person: "ada-there" }),
			schedule("new"),
		]);
	});

	test("go off to another Host, another Person, another Space or another Project", async () => {
		for (const other of [
			{ hostId: "other" },
			{ hostPersonId: "other" },
			{ fromSpace: "other" },
			{},
		]) {
			const { world, steps } = await setUp();
			await left(world, other);
			if (Object.keys(other).length === 0) {
				world.answer = answers({ p1: "there" });
			}
			await steps.start({});
			expect(world.schedules.get("p1")).toEqual([
				schedule("on", { enabled: false }),
				schedule("new"),
			]);
		}
	});
});

describe("a merge that stops", () => {
	test("without the Host's link: the flows of a Project that joins another wait, and the merge is not done", async () => {
		const { world, steps, state, goOn } = await setUp();
		world.answer = answers({ p1: "there" });
		world.batchFails = new Error("stopped");
		await expect(steps.start({})).rejects.toThrow("stopped");
		world.batchFails = null;
		world.online.delete("host");

		await expect(goOn()).rejects.toThrow(MERGE_WORDS.offline);
		expect(await state()).toBe("moved");
		expect(world.merged).toEqual([]);
		expect(world.pushedAsked).toEqual([]);

		world.online.add("host");
		expect(await goOn()).toMatchObject({ state: "pushed" });
		// The batch that stopped, and the one that landed.
		expect(world.plans).toHaveLength(2);
	});

	test("the flows merge in the name of the Person on the Host, once both documents are here", async () => {
		const { world, steps, state, goOn } = await setUp();
		world.projects = [moving("p1"), moving("p2")];
		world.answer = answers({ p1: "there", p2: "p2" });
		world.synced = false;
		await expect(steps.start({})).rejects.toBeInstanceOf(Refusal);
		expect(await state()).toBe("moved");
		expect(world.merged).toEqual([]);

		world.synced = true;
		await goOn();

		expect(world.inStep).toEqual([
			["there/current", "there/history"],
			["there/current", "there/history"],
		]);
		expect(world.merged).toEqual([
			{ from: "p1", to: "there", persons: { ada: "ada-there" } },
		]);
	});
});

describe("whether Personal waits to merge", () => {
	const none = { pending: false, state: null, hostName: null, blocked: null };

	test("a merge that started says how far it came, and why it cannot go on now", async () => {
		const { world, steps } = await setUp();
		world.callFails = new HostDown();
		await expect(steps.start({})).rejects.toThrow();
		const row = await world.record.merges.latest();

		expect(await steps.pending(row)).toEqual({
			pending: true,
			state: "planned",
			hostName: "Studio",
			blocked: null,
		});
		world.online.delete("host");
		expect(await steps.pending(row)).toMatchObject({
			state: "planned",
			blocked: MERGE_WORDS.offline,
		});
	});

	test("a Host with paired Devices, and a computer without a home Host, have nothing that waits", async () => {
		const { world, steps } = await setUp();
		world.pairedDevices.setHasPaired(true);
		expect(await steps.pending(null)).toEqual(none);

		world.pairedDevices.setHasPaired(false);
		world.revoke();
		expect(await steps.pending(null)).toEqual(none);
	});
});
