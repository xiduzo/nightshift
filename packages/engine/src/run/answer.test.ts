import { describe, expect, test } from "bun:test";
import type { OpenGateFact } from "../log";
import {
	ADA,
	FAR,
	inMemoryActionPorts,
	SPACE,
	stateOf,
} from "../runs/actions/adapters/out/in-memory-neighbours";
import { createAnswerPath, GateClosedError } from "./answer";

/**
 * The answer path, on the in-memory adapters of `runs/`: on a run another
 * Device walks, the answer travels to its Walker as `gate.resolve`. On a
 * run this computer walks, it is a Turn of the runner. Lane R6 moves these
 * tests with the path to `gates/`.
 */

/** What a request refuses with, or null. */
const refusalOf = (work: Promise<unknown>) =>
	work.then(
		() => null,
		(error: unknown) => error,
	);

/** A run that waits at its Gate on `step-1`. */
const waiting = stateOf({
	status: "waiting",
	gate: {
		stepId: "step-1",
		choices: [{ name: "approve" }, { name: "reject" }],
		form: null,
	} as unknown as OpenGateFact,
});

function setup() {
	const ports = inMemoryActionPorts();
	const saved: unknown[] = [];
	const answer = createAnswerPath({
		openRun: ports.openRun,
		walk: ports,
		artifacts: {
			saveAnswer: async (files) => {
				saved.push(files);
				return [];
			},
		},
	});
	return { ports, saved, answer };
}

describe("an answer to a run another Device walks", () => {
	test("travels to its Walker as gate.resolve, in the person's name, once", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, waiting);
		await answer(ADA, {
			runId: "run-1",
			spaceId: SPACE,
			stepId: "step-1",
			choice: "approve",
			via: "web",
		});
		expect(ports.walkers.sent).toEqual([
			{
				kind: "gate.resolve",
				payload: { stepId: "step-1", choice: "approve", via: "web" },
				spaceId: SPACE,
				runId: "run-1",
				walkerId: FAR,
				personId: ADA.personId,
			},
		]);
		// One is on its way: a second is refused before it travels.
		const refused = await refusalOf(
			answer(ADA, { runId: "run-1", stepId: "step-1", choice: "reject" }),
		);
		expect(refused).toBeInstanceOf(GateClosedError);
		expect((refused as GateClosedError).message).toBe(
			"An answer to this Gate is already on its way to the device that runs it.",
		);
		expect(ports.walkers.sent).toHaveLength(1);
	});

	test("is refused here, before it travels, when the run waits at no Gate", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, stateOf({ status: "running" }));
		const refused = await refusalOf(
			answer(ADA, { runId: "run-1", stepId: "step-1", choice: "approve" }),
		);
		expect(refused).toBeInstanceOf(GateClosedError);
		expect(ports.walkers.sent).toEqual([]);
	});
});

describe("an answer to a run this computer walks", () => {
	test("is a Turn of the runner, with the rule inside it", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		await answer(ADA, { runId: "run-1", stepId: "step-1", choice: "approve" });
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-1",
				intent: {
					kind: "answer",
					stepId: "step-1",
					choice: "approve",
					note: "",
				},
			},
		]);
		const refused = await refusalOf(
			answer(ADA, { runId: "run-1", stepId: "step-1", choice: "maybe" }),
		);
		expect(refused).not.toBeNull();
		expect(ports.turns.taken).toHaveLength(1);
	});

	test("keeps its files first, as artifacts of the run and the step", async () => {
		const { ports, saved, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		const files = [
			{ name: "notes.txt", mediaType: "text/plain", content: "aGk=" },
		];
		await answer(ADA, {
			runId: "run-1",
			stepId: "step-1",
			choice: "approve",
			files,
		});
		expect(saved).toEqual([{ runId: "run-1", stepId: "step-1", files }]);
		expect(ports.turns.taken).toHaveLength(1);
	});
});
