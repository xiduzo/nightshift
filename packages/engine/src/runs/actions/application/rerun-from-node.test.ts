import { describe, expect, test } from "bun:test";
import type { Refusal } from "@nightshift/refusal";
import type { RunRefusal } from "../../../run-status";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { rerunFromNode } from "./rerun-from-node";

/** A run again from a node, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

/** A run of a flow with one node, `build`, that ended. */
const flow = JSON.stringify({
	version: 9,
	inputs: [],
	outputs: [],
	start: "build",
	nodes: [
		{
			id: "build",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo built",
			stdout: "text",
		},
	],
	edges: [],
});
const failed = stateOf({ status: "failed" });

function setup() {
	const ports = inMemoryActionPorts();
	return { ports, rerun: rerunFromNode(ports) };
}

describe("a run again of a run this computer walks", () => {
	test("is a Turn of the runner from the node, by a person", async () => {
		const { ports, rerun } = setup();
		ports.put({ id: "run-1", flow }, failed);
		await rerun(ADA, {
			runId: "run-1",
			spaceId: SPACE,
			nodeId: "build",
			prompt: "Again.",
		});
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-1",
				intent: {
					kind: "rerun",
					by: "person",
					nodeId: "build",
					prompt: "Again.",
				},
			},
		]);
	});

	test("from a node its flow does not have is refused before the Turn", async () => {
		const { ports, rerun } = setup();
		ports.put({ id: "run-1", flow }, failed);
		const refused = await refusalOf(
			rerun(ADA, { runId: "run-1", nodeId: "deploy" }),
		);
		expect((refused as RunRefusal).rule).toBe("unknown-node");
		expect((refused as RunRefusal).message).toBe(
			`This run's flow has no node "deploy". Pick a step of the run's own flow, not one inside a called flow.`,
		);
		expect(ports.turns.taken).toEqual([]);
	});

	test("of a run that waits is refused inside the Turn", async () => {
		const { ports, rerun } = setup();
		ports.put({ id: "run-1", flow }, stateOf({ status: "waiting" }));
		const refused = await refusalOf(
			rerun(ADA, { runId: "run-1", nodeId: "build" }),
		);
		expect((refused as RunRefusal).rule).toBe("not-now");
		expect(ports.turns.taken).toEqual([]);
	});

	test("is refused while Night Shift moves the projects of its Space", async () => {
		const { ports, rerun } = setup();
		ports.put({ id: "run-1", flow }, failed);
		await ports.holds.hold(SPACE);
		const refused = await refusalOf(
			rerun(ADA, { runId: "run-1", nodeId: "build" }),
		);
		expect((refused as Refusal).kind).toBe("unavailable");
	});
});

test("only the Walker runs it again: a run another Device walks is refused, and nothing travels", async () => {
	const { ports, rerun } = setup();
	ports.put({ id: "run-1", flow, walkerId: FAR }, failed);
	const refused = await refusalOf(
		rerun(ADA, { runId: "run-1", nodeId: "build" }),
	);
	expect((refused as RunRefusal).rule).toBe("walked-elsewhere");
	expect(ports.walkers.sent).toEqual([]);
});

test("a viewer may not run it again", async () => {
	const { ports, rerun } = setup();
	ports.put({ id: "run-1", flow }, failed);
	const refused = await refusalOf(
		rerun(VIC, { runId: "run-1", nodeId: "build" }),
	);
	expect(refused).toBeInstanceOf(ports.RoleRefusal);
});
