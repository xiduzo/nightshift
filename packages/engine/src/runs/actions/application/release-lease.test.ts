import { describe, expect, test } from "bun:test";
import type { Hold } from "../../../log";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { releaseLease } from "./release-lease";

/** A release of a lease, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

/** A run that holds the lease `deploy`. */
const holding = stateOf({
	status: "sleeping",
	holds: [{ kind: "lease", name: "deploy" } as Hold],
});

function setup() {
	const ports = inMemoryActionPorts();
	return { ports, release: releaseLease(ports) };
}

describe("a release of a lease of a run this computer walks", () => {
	test("logs it first, tells the run's watchers, then its keeper frees it", async () => {
		const { ports, release } = setup();
		ports.put({ id: "run-1" }, holding);
		ports.leases.take("run-1", "deploy");
		await release(ADA, { runId: "run-1", spaceId: SPACE, name: "deploy" });
		expect(
			ports.facts.appended.map(({ type, payload }) => ({ type, payload })),
		).toEqual([
			{ type: "LeaseReleased", payload: { name: "deploy", why: "person" } },
		]);
		expect(ports.facts.changes).toEqual(["run-1"]);
		expect(ports.leases.released).toEqual([
			{ runId: "run-1", names: ["deploy"] },
		]);
		expect(ports.leases.holder("deploy")).toBeNull();
	});

	test("of a lease the run does not hold is refused, and nothing is freed", async () => {
		const { ports, release } = setup();
		ports.put({ id: "run-1" }, holding);
		const refused = await refusalOf(
			release(ADA, { runId: "run-1", name: "database" }),
		);
		expect((refused as RunRefusal).rule).toBe("not-now");
		expect((refused as RunRefusal).message).toBe(
			'This run does not hold the lease "database" now.',
		);
		expect(ports.facts.appended).toEqual([]);
		expect(ports.leases.released).toEqual([]);
	});
});

describe("a release of a lease of a run another Device walks", () => {
	test("travels to its Walker as lease.release", async () => {
		const { ports, release } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, holding);
		await release(ADA, { runId: "run-1", name: "deploy" });
		expect(ports.walkers.sent).toEqual([
			{
				kind: "lease.release",
				payload: { name: "deploy" },
				spaceId: SPACE,
				runId: "run-1",
				walkerId: FAR,
				personId: ADA.personId,
			},
		]);
		expect(ports.leases.released).toEqual([]);
	});

	test("is refused here, before it travels, when the log says the run does not hold it", async () => {
		const { ports, release } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "finished" }));
		const refused = await refusalOf(
			release(ADA, { runId: "run-1", name: "deploy" }),
		);
		expect((refused as RunRefusal).rule).toBe("not-now");
		expect(ports.walkers.sent).toEqual([]);
	});
});

test("a viewer may not release a lease", async () => {
	const { ports, release } = setup();
	ports.put({ id: "run-1" }, holding);
	const refused = await refusalOf(
		release(VIC, { runId: "run-1", name: "deploy" }),
	);
	expect(refused).toBeInstanceOf(ports.RoleRefusal);
	expect(ports.leases.released).toEqual([]);
});
