import { describe, expect, test } from "bun:test";
import type { UsageMoment } from "../../../usage";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { markRunUseful } from "./mark-run-useful";

/** Whether a run was useful, on in-memory adapters. */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

function setup() {
	const ports = inMemoryActionPorts();
	const notes: UsageMoment[] = [];
	const useful = markRunUseful({
		...ports,
		usage: { note: (moment) => notes.push(moment) },
	});
	return { ports, notes, useful };
}

describe("a person's answer to a run this computer walks", () => {
	test("is the score useful on the run, and a usage note", async () => {
		const { ports, notes, useful } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "finished" }));
		await useful(ADA, { runId: "run-1", spaceId: SPACE, useful: true });
		await useful(ADA, { runId: "run-1", useful: false });
		expect(
			ports.facts.appended.map(({ type, stepId, payload }) => ({
				type,
				stepId,
				payload,
			})),
		).toEqual([
			{
				type: "Scored",
				stepId: null,
				payload: { score: "useful", value: 1, label: null },
			},
			{
				type: "Scored",
				stepId: null,
				payload: { score: "useful", value: 0, label: null },
			},
		]);
		expect(notes).toEqual([
			{ kind: "run-scored", runId: "run-1", score: "useful", value: 1 },
			{ kind: "run-scored", runId: "run-1", score: "useful", value: 0 },
		]);
	});

	test("of a test run sends no usage note (ADR 27)", async () => {
		const { ports, notes, useful } = setup();
		ports.put(
			{ id: "run-1" },
			stateOf({ status: "finished", test: { pinned: {}, skipped: {} } }),
		);
		await useful(ADA, { runId: "run-1", useful: true });
		expect(ports.facts.appended).toHaveLength(1);
		expect(notes).toEqual([]);
	});
});

test("a person's answer to a run another Device walks travels as run.useful", async () => {
	const { ports, notes, useful } = setup();
	ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "finished" }));
	await useful(ADA, { runId: "run-1", useful: true });
	expect(ports.walkers.sent).toEqual([
		{
			kind: "run.useful",
			payload: { useful: true },
			spaceId: SPACE,
			runId: "run-1",
			walkerId: FAR,
			personId: ADA.personId,
		},
	]);
	expect(ports.facts.appended).toEqual([]);
	expect(notes).toEqual([]);
});

test("a viewer may not say whether a run was useful", async () => {
	const { ports, useful } = setup();
	ports.put({ id: "run-1" }, stateOf({ status: "finished" }));
	const refused = await refusalOf(
		useful(VIC, { runId: "run-1", useful: true }),
	);
	expect(refused).toBeInstanceOf(ports.RoleRefusal);
	expect(ports.facts.appended).toEqual([]);
});
