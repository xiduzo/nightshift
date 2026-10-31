import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LeaseTake } from "../contract";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createLeaseStore, type LeaseStore } from "./store";

const MINUTE = 60_000;

describe("the lease store", () => {
	let sandbox: Sandbox;
	let now: number;
	let store: LeaseStore;

	beforeEach(async () => {
		sandbox = await createSandbox();
		now = 1_000_000;
		store = createLeaseStore({ db: sandbox.db, now: () => now });
	});
	afterEach(async () => {
		await sandbox.cleanup();
	});

	const take = (runId: string, extra: Partial<LeaseTake> = {}) =>
		store.take({
			spaceId: "space-1",
			name: "branch:feature/x",
			runId,
			runTitle: `Run ${runId}`,
			walkerId: "device-1",
			ttlMs: 30 * MINUTE,
			...extra,
		});

	test("given a free name, when a run takes it, then the run holds it", async () => {
		expect(await take("run-a")).toEqual({ kind: "held" });
		expect(await store.list("space-1")).toEqual([
			{
				spaceId: "space-1",
				name: "branch:feature/x",
				runId: "run-a",
				runTitle: "Run run-a",
				walkerId: "device-1",
				since: 1_000_000,
				expiresAt: 1_000_000 + 30 * MINUTE,
			},
		]);
	});

	test("given a name another run holds, when a run takes it, then it is busy and names the holder", async () => {
		await take("run-a");
		now += MINUTE;
		expect(await take("run-b")).toEqual({
			kind: "busy",
			holder: {
				runId: "run-a",
				runTitle: "Run run-a",
				walkerId: "device-1",
				since: 1_000_000,
			},
		});
	});

	test("given a name the run holds, when it takes it again, then it still holds it from the first time", async () => {
		await take("run-a");
		now += MINUTE;
		expect(await take("run-a")).toEqual({ kind: "held" });
		const [lease] = await store.list("space-1");
		expect(lease?.since).toBe(1_000_000);
		expect(lease?.expiresAt).toBe(now + 30 * MINUTE);
	});

	test("given the same name in two Spaces, then each Space has its own lease", async () => {
		await take("run-a");
		expect(await take("run-b", { spaceId: "space-2" })).toEqual({
			kind: "held",
		});
	});

	test("given a lease past its ttl, when another run takes it, then that run holds it", async () => {
		await take("run-a", { ttlMs: 5 * MINUTE });
		now += 5 * MINUTE;
		expect(await take("run-b")).toEqual({ kind: "held" });
		expect((await store.list("space-1"))[0]?.runId).toBe("run-b");
	});

	test("given a renewed lease, then it holds for its ttl from the renewal", async () => {
		await take("run-a", { ttlMs: 5 * MINUTE });
		now += 4 * MINUTE;
		expect(
			await store.renew({
				spaceId: "space-1",
				runId: "run-a",
				names: ["branch:feature/x"],
			}),
		).toEqual([]);
		now += 4 * MINUTE;
		expect((await take("run-b")).kind).toBe("busy");
	});

	test("given a lease that expired or went to another run, when its old holder renews, then it hears that it lost it", async () => {
		await take("run-a", { ttlMs: 5 * MINUTE });
		await take("run-a", { name: "zac-docker-stack", ttlMs: 5 * MINUTE });
		now += 5 * MINUTE;
		await take("run-b");
		expect(
			await store.renew({
				spaceId: "space-1",
				runId: "run-a",
				names: ["branch:feature/x", "zac-docker-stack"],
			}),
		).toEqual(["branch:feature/x", "zac-docker-stack"]);
	});

	test("given a run that holds two leases, when it releases one by name, then only that one is free", async () => {
		await take("run-a");
		await take("run-a", { name: "zac-docker-stack" });
		await store.release({
			spaceId: "space-1",
			runId: "run-a",
			names: ["zac-docker-stack"],
		});
		expect((await store.list("space-1")).map((lease) => lease.name)).toEqual([
			"branch:feature/x",
		]);
	});

	test("given a run that holds leases, when it releases all, then none is left, and another run's stays", async () => {
		await take("run-a");
		await take("run-a", { name: "zac-docker-stack" });
		await take("run-b", { name: "ollama" });
		await store.release({ spaceId: "space-1", runId: "run-a" });
		expect((await store.list("space-1")).map((lease) => lease.runId)).toEqual([
			"run-b",
		]);
	});

	test("given two runs that take one name at once, then exactly one holds it", async () => {
		const answers = await Promise.all(
			["run-a", "run-b", "run-c"].map((runId) => take(runId)),
		);
		expect(answers.filter((answer) => answer.kind === "held")).toHaveLength(1);
		expect(answers.filter((answer) => answer.kind === "busy")).toHaveLength(2);
	});

	test("given a Walker, then a renewal or a release reaches only the leases that Walker renews", async () => {
		await take("run-a");
		expect(
			await store.renew({
				spaceId: "space-1",
				runId: "run-a",
				names: ["branch:feature/x"],
				walkerId: "device-2",
			}),
		).toEqual(["branch:feature/x"]);
		await store.release({
			spaceId: "space-1",
			runId: "run-a",
			walkerId: "device-2",
		});
		expect(await store.list("space-1")).toHaveLength(1);
		await store.release({
			spaceId: "space-1",
			runId: "run-a",
			walkerId: "device-1",
		});
		expect(await store.list("space-1")).toEqual([]);
	});
});
