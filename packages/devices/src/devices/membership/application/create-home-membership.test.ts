import { describe, expect, test } from "bun:test";
import { FAILURE_MESSAGE, Refusal } from "@nightshift/refusal";
import {
	HostDown,
	inMemoryHome,
	NotKnown,
	schedule,
} from "../adapters/out/in-memory-home";
import { MERGE_WORDS, SPLIT_WORDS } from "../domain/words";
import { createHomeMembership } from "./create-home-membership";

/** The membership of a home Host, on in-memory adapters. */

function setUp() {
	const { deps, world } = inMemoryHome();
	const membership = createHomeMembership(deps);
	const merges = () => world.record.mergesRows.map((row) => row.state);
	/** A merge into the Host that stopped at `planned`. */
	async function planned(hostId = "host") {
		await world.record.merges.plan({
			fromSpace: "own",
			hostId,
			personId: "ada",
			joined: [],
			backup: "/b",
		});
	}
	/** What a join shows. */
	async function steps(signal?: AbortSignal, hostId = "host") {
		const seen: unknown[] = [];
		for await (const step of membership.joined(hostId, signal)) seen.push(step);
		return seen;
	}
	/** Lets `keepFinishing` run: a while, or until `done`. */
	async function finishing(done?: () => boolean) {
		const stop = new AbortController();
		membership.keepFinishing(stop.signal, 5);
		await pass(done);
		stop.abort();
	}
	return { deps, world, membership, merges, planned, steps, finishing };
}

/** Runs `work` without its lines on the console. */
async function quietly<T>(work: () => Promise<T>): Promise<T> {
	const error = console.error;
	console.error = () => {};
	try {
		return await work();
	} finally {
		console.error = error;
	}
}

/** Waits a while, or until `done`: the test fails when it never comes. */
async function pass(done?: () => boolean) {
	const end = performance.now() + (done ? 2_000 : 40);
	while (performance.now() < end && !done?.()) await tick();
	if (done) expect(done()).toBe(true);
}
/** Lets what waits for nothing go on. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("one step at a time", () => {
	test("a step that failed, and one that is done, do not hold the next one", async () => {
		const { world, membership } = setUp();
		world.online.delete("host");
		await expect(membership.merge()).rejects.toThrow(MERGE_WORDS.offline);
		world.online.add("host");
		expect(await membership.merge()).toMatchObject({ state: "pushed" });
		await expect(membership.merge()).rejects.toThrow(MERGE_WORDS.merged);

		expect((await membership.leave()).split).toMatchObject({ state: "done" });
	});

	for (const how of ["leave", "revoked"] as const) {
		test(`${how} while a merge moves rows waits for it, then splits`, async () => {
			const { world, membership, merges } = setUp();
			world.run("r1");
			let left: Promise<unknown> = Promise.resolve();
			world.underHold = async () => {
				world.underHold = async () => {};
				if (how === "revoked") world.revoke();
				left =
					how === "leave"
						? membership.leave()
						: membership.revoked({ role: "home" });
				await tick();
				expect(world.record.splitsRows).toEqual([]);
			};

			expect(await membership.merge()).toMatchObject({ state: "pushed" });
			await left;

			expect(merges()).toEqual(["pushed"]);
			expect(world.record.splitsRows.map((s) => s.state)).toEqual(["done"]);
			expect(world.runs[0]?.spaceId).toBe("fresh");
		});
	}
});

describe("the merge on join", () => {
	test("waits until the Host lists the personal Space and answers", async () => {
		const { world, steps } = setUp();
		const theirs = world.listed;
		world.listed = [{ id: "team", name: "Team", personal: false }];
		world.online.delete("host");
		world.onSleep = () => {
			if (world.wait.sleeps.length === 2) world.listed = theirs;
			if (world.wait.sleeps.length === 4) world.online.add("host");
		};

		const seen = await steps();

		expect(world.wait.sleeps).toHaveLength(4);
		expect(seen).toMatchObject([
			{ kind: "merge-preview" },
			{ kind: "merged", result: { state: "pushed" } },
		]);
	});

	test("stops its wait when the person closes it, and merges nothing", async () => {
		const { world, steps, merges } = setUp();
		world.listed = [];
		const close = new AbortController();
		world.onSleep = () => close.abort();

		expect(await steps(close.signal)).toEqual([
			{ kind: "merge-skipped", reason: MERGE_WORDS.notListed },
		]);
		expect(world.wait.sleeps).toHaveLength(1);
		expect(merges()).toEqual([]);
	});

	test("says the words of a refusal, and never those of a failure", async () => {
		const { world, steps } = setUp();
		world.callFails = new Refusal("conflict", "The Host says no.");
		expect(await steps()).toEqual([
			{ kind: "merge-skipped", reason: "The Host says no." },
		]);
		world.callFails = new Error("SQLITE_BUSY at /data");
		const error = console.error;
		console.error = () => {};
		try {
			expect(await steps()).toEqual([
				{ kind: "merge-skipped", reason: FAILURE_MESSAGE },
			]);
		} finally {
			console.error = error;
		}
	});

	test("a merge that started goes on where it stopped, and the page says how far it came", async () => {
		const { world, membership } = setUp();
		world.callFails = new HostDown();
		await expect(membership.merge()).rejects.toThrow();
		expect(await membership.pending()).toMatchObject({
			pending: true,
			state: "planned",
		});

		world.callFails = null;
		expect(await membership.merge({ join: ["p1"] })).toMatchObject({
			state: "pushed",
		});
		expect(world.record.mergesRows).toHaveLength(1);
		// What the person chose when it started stays.
		expect(world.asked[0]?.join).toEqual([]);
	});
});

describe("leaving", () => {
	test("tells the Host first, while the key works, and only then gives it up and splits", async () => {
		const { world, membership } = setUp();
		world.joined();

		const result = await membership.leave();

		expect(world.log).toEqual([
			"told",
			"revoked host",
			"added host gone",
			"moved",
			"opened fresh",
			"key host",
		]);
		expect(world.copies.kept).toEqual([[]]);
		expect(result).toMatchObject({
			host: { id: "host", name: "Studio" },
			told: true,
			waiting: null,
			keyKept: false,
		});
	});

	test("a step of a leave that fails does not stop the next one, and the key that stays is said", async () => {
		for (const failing of ["key", "copies", "link"] as const) {
			const { deps, world, membership } = setUp();
			world.joined();
			const fail = () => Promise.reject(new Error("locked"));
			if (failing === "key") deps.keys.delete = fail;
			if (failing === "copies") deps.copies.keep = fail;
			if (failing === "link") deps.links.add = fail;

			const result = await quietly(() => membership.leave());

			expect(result.split).toMatchObject({ state: "done" });
			expect(result.keyKept).toBe(failing === "key");
			expect(world.copies.kept).toEqual(failing === "copies" ? [] : [[]]);
			expect(world.log.includes("key host")).toBe(failing !== "key");
		}
	});

	test("a key store that does not answer holds neither the leave nor the next start", async () => {
		const { deps, world } = setUp();
		world.joined();
		deps.keys.delete = () => new Promise(() => {});
		const membership = createHomeMembership({ ...deps, keyWaitMs: 5 });
		expect((await membership.leave()).keyKept).toBe(true);
		await membership.beforeLinks();
		await membership.beforeJoin();
	});

	test("a key of a Host that gave access back meanwhile stays", async () => {
		const { world, membership } = setUp();
		world.joined();
		world.underHold = async () => {
			world.hosts = world.hosts.map((h) => ({ ...h, revokedAt: null }));
		};

		expect((await membership.leave()).keyKept).toBe(false);

		expect(world.log).not.toContain("key host");
	});

	test("what a leave left goes at the next start: the copies and the key, of Hosts without access only", async () => {
		const { deps, world, membership } = setUp();
		const deleted: unknown[] = [];
		deps.keys.delete = async (...args) => {
			deleted.push(args);
		};
		await membership.beforeLinks();
		expect(deleted).toEqual([]);
		expect(world.copies.kept).toEqual([]);

		const guest = { ...world.hosts[0], hostId: "guest", role: "guest" };
		world.hosts = [...world.hosts, guest as never];
		world.revoke("guest");
		await membership.beforeLinks();
		expect(deleted).toEqual([["guest"]]);
		expect(world.copies.kept).toEqual([]);

		world.revoke();
		deps.keys.delete = () => Promise.reject(new Error("locked"));
		await quietly(() => membership.beforeLinks());
		expect(world.copies.kept).toEqual([[]]);
	});

	test("a Host that no longer knows this computer was told: without a link, it was not", async () => {
		const gone = setUp();
		gone.world.leave = () => Promise.reject(new NotKnown());
		expect((await gone.membership.leave()).told).toBe(true);

		const unlinked = setUp();
		unlinked.world.linked.clear();
		expect((await unlinked.membership.leave()).told).toBe(false);
	});

	test("a run that starts on the way makes the split wait: the leave stands, and says why", async () => {
		const { world, membership } = setUp();
		world.joined();
		world.leave = async () => {
			world.run("late", { spaceId: "theirs", status: "running" });
			return undefined;
		};

		expect(await membership.leave()).toMatchObject({
			told: true,
			split: null,
			waiting: SPLIT_WORDS.notDone(1),
		});
		expect(world.hosts[0]?.revokedAt).not.toBeNull();
		expect(await world.personalSpaces.personalId("ada")).toBe("theirs");

		// It is done by itself once the run is.
		const stop = new AbortController();
		membership.keepFinishing(stop.signal, 5);
		await pass();
		expect(world.record.splitsRows).toEqual([]);
		world.runs = [];
		await pass(() => world.record.splitsRows[0]?.state === "done");
		stop.abort();
		expect(await world.personalSpaces.personalId("ada")).toBe("fresh");
	});

	test("a failure of the split is not said as a reason to wait", async () => {
		const { world, membership } = setUp();
		world.joined();
		world.batchFails = new Error("disk full");

		await expect(membership.leave()).rejects.toThrow("disk full");
	});
});

describe("when a Host removes this computer's access", () => {
	test("a guest Host changes nothing: not Personal, not the copies of the other Devices", async () => {
		const { world, membership, merges, planned } = setUp();
		world.joined();
		world.revoke();
		await planned("gone");

		expect(await membership.revoked({ role: "guest" })).toBeNull();

		expect(world.copies.kept).toEqual([]);
		expect(world.record.splitsRows).toEqual([]);
		expect(merges()).toEqual(["planned"]);
	});

	test("the home Host: the copies of the other Devices go, also while a run holds the split back", async () => {
		const { world, membership } = setUp();
		world.joined();
		world.revoke();
		world.run("r1", { spaceId: "theirs", status: "waiting" });

		await expect(membership.revoked({ role: "home" })).rejects.toThrow(
			SPLIT_WORDS.notDone(1),
		);

		expect(world.copies.kept).toEqual([[]]);
	});

	test("the split follows also when the copies of the other Devices stay", async () => {
		const { deps, world, membership } = setUp();
		world.joined();
		world.revoke();
		deps.copies.keep = () => Promise.reject(new Error("disk full"));

		const split = await quietly(() => membership.revoked({ role: "home" }));

		expect(split).toMatchObject({ state: "done" });
	});

	test("a merge that did not move a row ends only when its own Host is gone", async () => {
		const { world, membership, merges, planned } = setUp();
		await planned();
		expect(await membership.revoked({ role: "home" })).toBeNull();
		expect(merges()).toEqual(["planned"]);

		world.revoke();
		expect(await membership.revoked({ role: "home" })).toBeNull();
		expect(merges()).toEqual([]);

		// Its Host is not on record any more: another is the home Host now.
		world.hosts = world.hosts.map((h) => ({ ...h, revokedAt: null }));
		await planned("unknown");
		expect(await membership.revoked({ role: "home" })).toBeNull();
		expect(merges()).toEqual([]);
		expect(world.personalSpaces.split).toEqual([]);
	});
});

describe("a split that waits", () => {
	/** A leave whose batch failed: the split is planned. */
	async function waiting() {
		const at = setUp();
		const { world, membership } = at;
		world.joined();
		world.schedules.set("p1", [schedule("on", { person: "ada-there" })]);
		world.sync();
		world.batchFails = new Error("disk full");
		await expect(membership.leave()).rejects.toThrow("disk full");
		world.batchFails = null;
		return at;
	}
	const joinAgain = (world: ReturnType<typeof setUp>["world"]) => {
		world.hosts = world.hosts.map((h) => ({ ...h, revokedAt: null }));
	};

	test("is forgotten when the same Host gave access back, and its pauses never reach the Host", async () => {
		const { world, membership, steps, finishing } = await waiting();

		joinAgain(world);
		await membership.beforeJoin();
		world.sync();
		expect(await steps()).toEqual([]);
		await finishing();

		expect(world.record.splitsRows).toEqual([]);
		expect(await world.personalSpaces.personalId("ada")).toBe("theirs");
		expect(world.hostSchedules.get("p1")).toEqual([
			schedule("on", { person: "ada-there" }),
		]);
	});

	test("ends first when this computer joined another Host, and then Personal merges there", async () => {
		const { world, steps } = await waiting();
		const [first] = world.hosts;
		if (!first) throw new Error("No Host.");
		world.hosts = [
			{ ...first, hostId: "second", name: "Second", revokedAt: null },
		];
		world.linked.add("second");
		world.online.add("second");
		world.listed = [{ id: "there", name: "Personal", personal: true }];
		world.listedBy = "second";
		world.answer = (input) => ({
			spaceId: "there",
			projectMap: Object.fromEntries(input.projects.map((p) => [p.id, p.id])),
			personMap: { ada: "ada-there" },
			elsewhere: [],
		});

		const seen = await steps(undefined, "second");

		expect(seen).toMatchObject([{ kind: "merge-preview" }, { kind: "merged" }]);
		expect(world.record.splitsRows.map((s) => s.state)).toEqual(["done"]);
		expect(world.projects.map((p) => p.spaceId)).toEqual(["there"]);
		// Its Projects left the first Host's Space for its own, then for the second's.
		expect(world.record.mergesRows.map((m) => m.fromSpace)).toEqual(["fresh"]);
	});

	test("that a run held back before it was planned holds a merge into another Host too", async () => {
		const { world, membership } = setUp();
		world.joined();
		world.leave = async () => {
			world.run("late", { spaceId: "theirs", status: "running" });
			return undefined;
		};
		await membership.leave();
		expect(world.record.splitsRows).toEqual([]);
		const [first] = world.hosts;
		if (!first) throw new Error("No Host.");
		world.hosts = [first, { ...first, hostId: "second", revokedAt: null }];
		world.linked.add("second");
		world.online.add("second");
		world.listed = [{ id: "there", name: "Personal", personal: true }];
		world.listedBy = "second";
		world.run("done");
		await expect(membership.merge()).rejects.toThrow(MERGE_WORDS.leaving);
		expect(world.record.mergesRows).toEqual([]);
	});

	test("a join as a guest does not forget it: the split ends", async () => {
		const { world, membership } = await waiting();
		world.hosts = world.hosts.map((h) => ({
			...h,
			role: "guest",
			revokedAt: null,
		}));
		await membership.beforeJoin();
		expect(world.record.splitsRows.map((s) => s.state)).toEqual(["done"]);
	});

	test("that cannot go on now holds a merge, and the page says why", async () => {
		const { world, membership } = await waiting();
		const [first] = world.hosts;
		if (!first) throw new Error("No Host.");
		world.hosts = [{ ...first, hostId: "second", revokedAt: null }];
		world.run("late", { spaceId: "theirs", status: "running" });

		await expect(membership.merge()).rejects.toThrow(MERGE_WORDS.leaving);
		expect(await membership.pending()).toMatchObject({
			pending: true,
			blocked: MERGE_WORDS.leaving,
		});
		expect(world.record.mergesRows).toEqual([]);
	});
});

describe("going on with what stopped", () => {
	test("a merge that moved its rows ends by itself when the Host is back", async () => {
		const { world, membership, merges, finishing } = setUp();
		world.pushed = false;
		await membership.merge();
		expect(merges()).toEqual(["moved"]);

		world.pushed = true;
		await finishing(() => merges()[0] === "pushed");
		expect(merges()).toEqual(["pushed"]);
		expect(world.plans).toHaveLength(1);
	});

	test("a merge that did not move a row waits for the person", async () => {
		const { world, merges, planned, finishing } = setUp();
		await planned();

		await finishing();

		expect(merges()).toEqual(["planned"]);
		expect(world.asked).toEqual([]);
	});

	test("what a done merge left goes once, at start", async () => {
		const { world, membership, finishing } = setUp();
		await membership.merge();
		expect(world.forgotten).toEqual(["own"]);

		await finishing();

		expect(world.forgotten).toEqual(["own", "own"]);
	});

	test("an attempt does not pile up behind a step under way", async () => {
		const { world, membership, finishing } = setUp();
		const reads = { count: 0 };
		const unfinished = world.record.unfinished;
		world.record.unfinished = async () => {
			reads.count++;
			return unfinished();
		};
		let release = () => {};
		world.underHold = () =>
			new Promise((resolve) => {
				release = () => resolve(undefined);
			});
		const merging = membership.merge();

		await finishing();
		release();
		await merging;
		await tick();

		// The merge's own reads: no attempt waited behind it.
		const alone = setUp();
		let own = 0;
		const unfinishedAlone = alone.world.record.unfinished;
		alone.world.record.unfinished = async () => {
			own++;
			return unfinishedAlone();
		};
		await alone.membership.merge();
		expect(reads.count).toBe(own);
	});
});
