import { describe, expect, test } from "bun:test";
import { FLOW_VERSION } from "@nightshift/flows";
import type { Refusal } from "@nightshift/refusal";
import { NIGHT_SHIFT } from "../../../contract";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryMovePorts,
	SPACE,
	stateOf,
	THIS_DEVICE,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { moveRun } from "./move-run";

/**
 * A move of a run's walk, on in-memory adapters. The walk itself, from
 * one computer to the next, is proven whole in `test/engine/move.test.ts`.
 */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error as Refusal,
	);

/** The Walker of this computer's runs (`RunFacts.walkerId` of the twin). */
const HERE = "this-computer";

/** The run's flow, in this build's format. */
const FLOW = JSON.stringify({ version: FLOW_VERSION });

function setup() {
	const ports = inMemoryMovePorts();
	ports.devices.add({
		deviceId: "laptop",
		name: "laptop",
		thisDevice: false,
		online: true,
		hasClone: true,
		personId: ADA.personId,
		flowVersion: FLOW_VERSION,
		testRuns: true,
	});
	return { ports, move: moveRun(ports) };
}

/** Nothing of the walk was kept or logged: the run stays where it is. */
function keptNothing(ports: ReturnType<typeof setup>["ports"]) {
	expect(ports.handover.kept).toEqual([]);
	expect(ports.facts.appended).toEqual([]);
	expect(ports.handover.moves).toEqual([]);
	expect(ports.turns.forgotten).toEqual([]);
}

describe("a move of a run this computer walks", () => {
	test("keeps its walk state, lets go of it here, logs WalkerMoved and follows it in the row", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", flow: FLOW });
		await move(ADA, { runId: "run-1", spaceId: SPACE, to: "laptop" });
		expect(ports.held).toEqual([{ runId: "run-1", arrival: false }]);
		expect(ports.devices.asked).toEqual([
			{ runId: "run-1", personId: ADA.personId, deviceId: "laptop" },
		]);
		expect(ports.handover.kept).toEqual(["run-1"]);
		expect(ports.turns.forgotten).toEqual(["run-1"]);
		expect(
			ports.facts.appended.map(({ type, payload }) => ({ type, payload })),
		).toEqual([
			{
				type: "WalkerMoved",
				payload: { from: HERE, to: "laptop", by: ADA.personId },
			},
		]);
		expect(ports.handover.moves).toEqual(ports.facts.appended);
		expect(ports.facts.changes).toEqual(["run-1"]);
	});

	test("that cannot reach the Host of its Space logs nothing and keeps the run here", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", flow: FLOW });
		ports.handover.failNextKeep();
		const refused = await refusalOf(
			move(ADA, { runId: "run-1", to: "laptop" }),
		);
		expect(refused?.kind).toBe("unavailable");
		expect(ports.facts.appended).toEqual([]);
		expect(ports.turns.forgotten).toEqual([]);
	});

	test("is refused while a step runs, to this computer, to an unknown Device and without a Person, and keeps nothing", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", flow: FLOW }, stateOf({ status: "running" }));
		ports.put(
			{ id: "run-2", flow: FLOW },
			stateOf({ status: "waiting" }),
			true,
		);
		for (const runId of ["run-1", "run-2"]) {
			const running = await refusalOf(move(ADA, { runId, to: "laptop" }));
			expect(running?.message).toBe(
				"The run is in the middle of a step. Move it when it waits, sleeps or is stopped.",
			);
		}

		ports.put({ id: "run-3", flow: FLOW });
		for (const to of [HERE, THIS_DEVICE]) {
			const here = await refusalOf(move(ADA, { runId: "run-3", to }));
			expect((here as RunRefusal).rule).toBe("walks-here");
			expect(here?.message).toBe("This run already runs on this computer.");
		}
		const unknown = await refusalOf(
			move(ADA, { runId: "run-3", to: "no-such-device" }),
		);
		expect((unknown as RunRefusal).rule).toBe("not-your-device");
		expect(unknown?.message).toBe("That device is not one of yours.");
		const signedOut = await refusalOf(
			move(NIGHT_SHIFT, { runId: "run-3", to: "laptop" }),
		);
		expect((signedOut as RunRefusal).rule).toBe("signed-out");
		expect(signedOut?.message).toBe("Sign in to act on this run.");
		keptNothing(ports);
	});

	test("is refused when the planner refuses its Device, and keeps nothing", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", flow: FLOW });
		ports.devices.offline("laptop");
		const refused = await refusalOf(
			move(ADA, { runId: "run-1", to: "laptop" }),
		);
		expect(refused?.kind).toBe("unavailable");
		expect(refused?.message).toBe(
			"laptop is offline. Move the run when it is online.",
		);
		keptNothing(ports);
	});

	test("is refused to a Device of an older Night Shift, and keeps nothing", async () => {
		const { ports, move } = setup();
		ports.put({
			id: "run-1",
			flow: FLOW,
			bodyFlows: JSON.stringify({ sub: { version: FLOW_VERSION + 1 } }),
		});
		const refused = await refusalOf(
			move(ADA, { runId: "run-1", to: "laptop" }),
		);
		expect(refused?.kind).toBe("conflict");
		expect(refused?.message).toBe(
			"laptop runs an older version of Night Shift. Update Night Shift on laptop.",
		);
		keptNothing(ports);
	});

	test("a test run is refused to a Device of a Night Shift without test runs, and keeps nothing; a run that is no test goes there (ADR 27)", async () => {
		const { ports, move } = setup();
		ports.devices.add({
			deviceId: "desk",
			name: "desk",
			thisDevice: false,
			online: true,
			hasClone: true,
			personId: ADA.personId,
			flowVersion: FLOW_VERSION,
		});
		ports.put(
			{ id: "tested", flow: FLOW },
			stateOf({
				status: "waiting",
				test: { pinned: {}, skipped: { a: "pass" } },
			}),
		);
		const refused = await refusalOf(move(ADA, { runId: "tested", to: "desk" }));
		expect(refused?.message).toBe(
			"desk runs an older version of Night Shift. Update Night Shift on desk.",
		);
		keptNothing(ports);

		ports.put({ id: "run-1", flow: FLOW });
		await move(ADA, { runId: "run-1", to: "desk" });
		expect(ports.handover.kept).toEqual(["run-1"]);
	});
});

describe("a move of a run another Device walks", () => {
	test("travels to its Walker as run.move, in the person's name", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", walkerId: FAR });
		await move(ADA, { runId: "run-1", spaceId: SPACE, to: "desk" });
		expect(ports.walkers.sent).toEqual([
			{
				kind: "run.move",
				payload: { to: "desk" },
				spaceId: SPACE,
				runId: "run-1",
				walkerId: FAR,
				personId: ADA.personId,
			},
		]);
		expect(ports.handover.kept).toEqual([]);
	});

	test("needs a Person, and is refused here by the status rule before it travels", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "finished" }));
		const signedOut = await refusalOf(
			move(NIGHT_SHIFT, { runId: "run-1", to: "desk" }),
		);
		expect((signedOut as RunRefusal).rule).toBe("signed-out");
		const ended = await refusalOf(move(ADA, { runId: "run-1", to: "desk" }));
		expect((ended as RunRefusal).rule).toBe("not-now");
		expect(ports.walkers.sent).toEqual([]);
	});
});

describe("who may move a run", () => {
	test("a viewer may not, and a Person who is no Member does not find the run", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", flow: FLOW });
		const viewer = await refusalOf(move(VIC, { runId: "run-1", to: "laptop" }));
		expect(viewer?.kind).toBe("forbidden");
		const stranger = await refusalOf(
			move(
				{ personId: "person-sam", door: "session" },
				{ runId: "run-1", to: "laptop" },
			),
		);
		expect(stranger?.kind).toBe("not-found");
		expect(stranger?.message).toBe("Night Shift cannot find this run.");
		keptNothing(ports);
	});

	test("a run of another Space is not found there", async () => {
		const { ports, move } = setup();
		ports.put({ id: "run-1", flow: FLOW });
		const refused = await refusalOf(
			move(ADA, { runId: "run-1", spaceId: "space-2", to: "laptop" }),
		);
		expect(refused?.message).toBe("Night Shift cannot find this run.");
		keptNothing(ports);
	});
});
