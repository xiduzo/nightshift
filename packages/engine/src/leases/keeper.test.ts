import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HostUnreachableError, type LeaseHost } from "../contract";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { leaseHolds } from "./holds";
import { createLeaseKeeper } from "./keeper";
import { createLeaseStore, type LeaseStore } from "./store";

const MINUTE = 60_000;
const run = (id: string, spaceId = "space-1") => ({
	id,
	spaceId,
	title: `Run ${id}`,
});

describe("the lease keeper", () => {
	let sandbox: Sandbox;
	let now: number;
	let store: LeaseStore;
	/** The leases of the Spaces a Host keeps, as that Host's own store. */
	let hostStore: LeaseStore;
	let hostReachable: boolean;
	let freed: number;
	let lost: { runId: string; names: readonly string[] }[];

	const host: LeaseHost = {
		take: (take) =>
			hostReachable
				? hostStore.take(take)
				: Promise.reject(new HostUnreachableError()),
		renew: (input) =>
			hostReachable
				? hostStore.renew(input)
				: Promise.reject(new HostUnreachableError()),
		release: (input) =>
			hostReachable
				? hostStore.release(input)
				: Promise.reject(new HostUnreachableError()),
	};

	const keeperFor = () =>
		createLeaseKeeper({
			db: sandbox.db,
			store,
			hostedElsewhere: async (spaceId) => spaceId === "hosted",
			relay: host,
			walkerId: async () => "device-1",
			minuteMs: MINUTE,
			onFreed: () => {
				freed++;
			},
			onLost: (runId, names) => {
				lost.push({ runId, names });
			},
		});

	beforeEach(async () => {
		sandbox = await createSandbox();
		now = 1_000_000;
		store = createLeaseStore({ db: sandbox.db, now: () => now });
		hostStore = createLeaseStore({ db: sandbox.db, now: () => now });
		hostReachable = true;
		freed = 0;
		lost = [];
	});
	afterEach(async () => {
		await sandbox.cleanup();
	});

	test("given a Space this computer keeps, when a run takes a lease, then this computer's store holds it for the ttl", async () => {
		const keeper = keeperFor();
		expect(
			await keeper.take(run("run-a"), { name: "stack", ttlMinutes: 10 }),
		).toEqual({ kind: "held" });
		expect(await store.list("space-1")).toMatchObject([
			{ name: "stack", runId: "run-a", walkerId: "device-1" },
		]);
		expect((await store.list("space-1"))[0]?.expiresAt).toBe(now + 10 * MINUTE);
	});

	test("given no ttl, then a lease holds for 30 minutes", async () => {
		await keeperFor().take(run("run-a"), { name: "stack" });
		expect((await store.list("space-1"))[0]?.expiresAt).toBe(now + 30 * MINUTE);
	});

	test("given a Space a Host keeps, when the Host cannot be reached, then the take is unreachable, not busy", async () => {
		hostReachable = false;
		expect(
			await keeperFor().take(run("run-a", "hosted"), { name: "stack" }),
		).toEqual({ kind: "unreachable" });
	});

	test("given a Space a Host keeps, then two runs of different Devices exclude each other there", async () => {
		const keeper = keeperFor();
		expect(
			await keeper.take(run("run-a", "hosted"), { name: "stack" }),
		).toEqual({ kind: "held" });
		expect(
			await keeper.take(run("run-b", "hosted"), { name: "stack" }),
		).toMatchObject({ kind: "busy", holder: { runId: "run-a" } });
	});

	test("given a run that holds leases, when it ends done, then they are free, and the runs that wait here hear it", async () => {
		const keeper = keeperFor();
		await keeper.take(run("run-a"), { name: "stack" });
		await keeper.take(run("run-a"), { name: "branch:x" });
		await leaseHolds(keeper).ended("run-a", "finished");
		expect(await store.list("space-1")).toEqual([]);
		expect(freed).toBe(1);
	});

	test.each(["failed", "stopped"] as const)(
		"given a run that holds a lease, when it ends %s, then the lease is free",
		async (status) => {
			const keeper = keeperFor();
			await keeper.take(run("run-a"), { name: "stack" });
			await leaseHolds(keeper).ended("run-a", status);
			expect(await store.list("space-1")).toEqual([]);
		},
	);

	test("given an interrupted run, then it keeps its leases until it does not continue", async () => {
		const keeper = keeperFor();
		await keeper.take(run("run-a"), { name: "stack" });
		const holds = leaseHolds(keeper);
		await holds.ended("run-a", "interrupted");
		expect(await store.list("space-1")).toHaveLength(1);
		await holds.notContinuing("run-a");
		expect(await store.list("space-1")).toEqual([]);
	});

	test("given a Space a Host keeps, when its run ends, then the Host frees the lease and this computer's waiting runs are not told", async () => {
		const keeper = keeperFor();
		await keeper.take(run("run-a", "hosted"), { name: "stack" });
		await keeper.release("run-a");
		expect(await hostStore.list("hosted")).toEqual([]);
		expect(freed).toBe(0);
	});

	test("given a Host that cannot be reached, when a run ends, then nothing throws and the Host lets the lease expire", async () => {
		const keeper = keeperFor();
		await keeper.take(run("run-a", "hosted"), { name: "stack" });
		hostReachable = false;
		await keeper.release("run-a");
		hostReachable = true;
		now += 30 * MINUTE;
		expect(
			await keeper.take(run("run-b", "hosted"), { name: "stack" }),
		).toEqual({ kind: "held" });
	});

	test("given a living run, when the keeper renews, then its leases outlast their first ttl", async () => {
		const keeper = keeperFor();
		await keeper.take(run("run-a"), { name: "stack", ttlMinutes: 10 });
		now += 8 * MINUTE;
		await keeper.renewAll();
		now += 8 * MINUTE;
		expect(await keeper.take(run("run-b"), { name: "stack" })).toMatchObject({
			kind: "busy",
		});
		expect(lost).toEqual([]);
	});

	test("given a lease that expired while its Host was away, when the keeper renews, then the run hears that it lost it", async () => {
		const keeper = keeperFor();
		await keeper.take(run("run-a", "hosted"), {
			name: "stack",
			ttlMinutes: 10,
		});
		hostReachable = false;
		now += 8 * MINUTE;
		await keeper.renewAll();
		hostReachable = true;
		now += 8 * MINUTE;
		await keeper.take(run("run-b", "hosted"), { name: "stack" });
		await keeper.renewAll();
		expect(lost).toEqual([{ runId: "run-a", names: ["stack"] }]);
		// It renews only what it holds from now on.
		await keeper.renewAll();
		expect(lost).toHaveLength(1);
	});

	test("given leases a run held before a restart, when they are tracked, then the keeper renews them", async () => {
		await keeperFor().take(run("run-a"), { name: "stack", ttlMinutes: 10 });
		const restarted = keeperFor();
		restarted.track("run-a", "space-1", ["stack"]);
		now += 8 * MINUTE;
		await restarted.renewAll();
		now += 8 * MINUTE;
		expect(await restarted.take(run("run-b"), { name: "stack" })).toMatchObject(
			{ kind: "busy" },
		);
	});
});
