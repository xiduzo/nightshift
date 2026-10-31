import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import type { LeaseNode } from "@nightshift/flows";
import { HostUnreachableError } from "../contract";
import { createLeaseKeeper, createLeaseStore } from "../leases";
import { foldRun } from "../log";
import { deriveSleep, deriveSteps } from "../read/run-views";
import {
	drive,
	flowOf,
	type Harness,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import type { LeaseTaker } from "./context";

/**
 * The Lease node on the compiled graph, with a real lease store on the
 * sandbox's database. The clock is moved by hand, and a wake is what the
 * runner sends: `Command({ resume: { kind: "wake" } })`.
 */

const lease = (extra: Partial<LeaseNode> = {}): LeaseNode => ({
	id: "own",
	type: "lease",
	position: { x: 0, y: 0 },
	name: "branch:{{branch}}",
	...extra,
});

let sandbox: Sandbox;
let now: number;
beforeEach(async () => {
	sandbox = await createSandbox();
	now = 1_000_000;
});
afterEach(async () => {
	await sandbox.cleanup();
});

/** The keeper of the engine, over the sandbox's store: this Replica keeps the Space. */
function keeper() {
	return createLeaseKeeper({
		db: sandbox.db,
		store: createLeaseStore({ db: sandbox.db, now: () => now }),
		hostedElsewhere: async () => false,
		walkerId: async () => sandbox.deviceId,
		minuteMs: MINUTE,
	});
}

/** A run of one Lease node, with the input `branch`. */
async function leaseRun(
	node: LeaseNode,
	leases: LeaseTaker = keeper(),
): Promise<Harness> {
	const h = await startRun(
		sandbox,
		flowOf({
			inputs: [{ name: "branch" }],
			start: node.id,
			nodes: [node],
			edges: [],
		}),
		{ inputs: { branch: "feature/x" }, leases, now: () => now },
	);
	return h;
}

describe("the Lease node", () => {
	test("given a free lease, then it ends held, logs the lease it took and names it", async () => {
		const h = await leaseRun(lease({ ttlMinutes: 10 }));
		const driven = await drive(h, { inputs: { branch: "feature/x" } });
		expect(driven.outcome.kind).toBe("ended");
		const events = await h.events();
		const [step] = deriveSteps(foldRun(events));
		expect(step).toMatchObject({
			outcome: "held",
			outputs: { name: "branch:feature/x", waited_minutes: 0 },
		});
		expect(payloads(events, "LeaseTaken")).toEqual([
			{ name: "branch:feature/x", nodeId: "own", ttlMinutes: 10, scope: null },
		]);
	});

	test("given no ttl, then the log says the lease holds for 30 minutes", async () => {
		const h = await leaseRun(lease());
		await drive(h, { inputs: { branch: "feature/x" } });
		expect(payloads(await h.events(), "LeaseTaken")[0]?.ttlMinutes).toBe(30);
	});

	test("given a lease another run holds and no wait, then it ends busy at once and names that run", async () => {
		const leases = keeper();
		await leases.take(
			{ id: "other", spaceId: sandbox.spaceId, title: "Fix red PRs" },
			{ name: "branch:feature/x" },
		);
		const h = await leaseRun(lease(), leases);
		const driven = await drive(h, { inputs: { branch: "feature/x" } });
		// No `busy` edge: the run fails, so a person sees why.
		expect(driven.outcome.kind).toBe("parked");
		const [step] = deriveSteps(foldRun(await h.events()));
		expect(step).toMatchObject({
			outcome: "busy",
			outputs: {
				name: "branch:feature/x",
				holder: "other",
				holder_title: "Fix red PRs",
				waited_minutes: 0,
			},
		});
		expect(payloads(await h.events(), "LeaseTaken")).toEqual([]);
	});

	test("given a busy lease and a wait, then it waits, asks again every minute, and ends held once the lease is free", async () => {
		const leases = keeper();
		const other = { id: "other", spaceId: sandbox.spaceId, title: "Fix" };
		await leases.take(other, { name: "branch:feature/x" });
		const h = await leaseRun(lease({ waitMinutes: 5 }), leases);
		const first = await drive(h, { inputs: { branch: "feature/x" } });
		expect(first.parked[0]).toMatchObject({
			kind: "wait",
			reason: "lease",
			until: now + MINUTE,
		});
		const sleep = deriveSleep(foldRun(await h.events()));
		expect(sleep?.message).toBe(
			'Waits for the lease "branch:feature/x". The run "Fix" holds it.',
		);
		expect(payloads(await h.events(), "WaitStarted")[0]?.lease).toEqual({
			name: "branch:feature/x",
			holder: "other",
			holderTitle: "Fix",
		});

		now += MINUTE;
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked[0]).toMatchObject({ reason: "lease" });

		await leases.release("other");
		now += 2 * MINUTE;
		const third = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(third.outcome.kind).toBe("ended");
		const [step] = deriveSteps(foldRun(await h.events()));
		expect(step).toMatchObject({
			outcome: "held",
			outputs: { waited_minutes: 3 },
		});
	});

	test("given a lease that stays busy, then it ends busy once the wait is over, not before", async () => {
		const leases = keeper();
		await leases.take(
			{ id: "other", spaceId: sandbox.spaceId, title: "Fix" },
			{ name: "branch:feature/x" },
		);
		const h = await leaseRun(lease({ waitMinutes: 2 }), leases);
		await drive(h, { inputs: { branch: "feature/x" } });
		now += MINUTE;
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		// The next ask is at the end of the wait.
		expect(second.parked[0]).toMatchObject({
			reason: "lease",
			until: 1_000_000 + 2 * MINUTE,
		});
		now += MINUTE;
		await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		const [step] = deriveSteps(foldRun(await h.events()));
		expect(step).toMatchObject({
			outcome: "busy",
			outputs: { holder: "other", waited_minutes: 2 },
		});
	});

	test("given a Host that cannot be reached, then it waits for the Host, also past the wait, and is not busy", async () => {
		let reachable = false;
		const store = createLeaseStore({ db: sandbox.db, now: () => now });
		const leases = createLeaseKeeper({
			db: sandbox.db,
			store,
			hostedElsewhere: async () => true,
			relay: {
				take: (take) =>
					reachable
						? store.take(take)
						: Promise.reject(new HostUnreachableError()),
				renew: (input) => store.renew(input),
				release: (input) => store.release(input),
			},
			walkerId: async () => sandbox.deviceId,
			minuteMs: MINUTE,
		});
		const h = await leaseRun(lease({ waitMinutes: 1 }), leases);
		const first = await drive(h, { inputs: { branch: "feature/x" } });
		expect(first.parked[0]).toMatchObject({ reason: "lease" });
		expect(deriveSleep(foldRun(await h.events()))?.message).toBe(
			'Waits for the computer that keeps this Space, to take the lease "branch:feature/x".',
		);
		now += 3 * MINUTE;
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked[0]).toMatchObject({
			reason: "lease",
			until: now + MINUTE,
		});
		reachable = true;
		now += MINUTE;
		expect(
			(
				await drive(
					h,
					new Command({ resume: { kind: "wake", early: false } }),
					h.graph(),
				)
			).outcome.kind,
		).toBe("ended");
	});

	test("given a name that renders empty, then the step fails with a plain message", async () => {
		const h = await leaseRun(lease({ name: "{{missing}}" }));
		await drive(h, { inputs: { branch: "feature/x" } });
		const [step] = deriveSteps(foldRun(await h.events()));
		expect(step).toMatchObject({
			outcome: "error",
			error: 'The name of the lease is empty. Check the name of "own".',
		});
	});
});
