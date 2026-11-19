import { describe, expect, test } from "bun:test";
import type { OpenGateFact } from "../../log";
import {
	ADA,
	FAR,
	inMemoryGatePorts,
	openGate,
	SPACE,
	stateOf,
	VIC,
} from "../adapters/out/in-memory-neighbours";
import { GateClosedError } from "../domain/answer";
import { NeedsApp } from "../domain/lock-screen";
import { answerGate } from "./answer-gate";

/**
 * The answer to a Gate, on the in-memory adapters: on a run another Device
 * walks, the answer travels to its Walker as `gate.resolve`. On a run this
 * computer walks, it is a Turn of the runner. An answer from the lock
 * screen goes only to a Gate marked for it, at every door.
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

function setup(options: { reachable?: boolean } = {}) {
	const ports = inMemoryGatePorts(options);
	return { ports, answer: answerGate(ports) };
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
		const { ports, answer } = setup();
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
		expect(ports.files.saved).toEqual([
			{ runId: "run-1", stepId: "step-1", files },
		]);
		expect(ports.turns.taken).toHaveLength(1);
	});
});

describe("who may answer", () => {
	test("a viewer may not, and a Person of no Space does not find the run", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		const asViewer = await refusalOf(
			answer(VIC, { runId: "run-1", stepId: "step-1", choice: "approve" }),
		);
		expect(asViewer).toBeInstanceOf(ports.RoleRefusal);
		const asStranger = await refusalOf(
			answer(
				{ personId: "person-nobody", door: "session" },
				{ runId: "run-1", stepId: "step-1", choice: "approve" },
			),
		);
		expect((asStranger as { kind?: string }).kind).toBe("not-found");
		expect(ports.turns.taken).toEqual([]);
	});
});

describe("an answer from the lock screen (decision 77: every door)", () => {
	/** The run's Gate as the Space lists it: on `step-1`, marked or not. */
	function listed(
		ports: ReturnType<typeof setup>["ports"],
		lockScreen: boolean,
	) {
		ports.gates.setOpen(SPACE, [
			{
				...openGate(SPACE, "run-1", 1, "step-1"),
				choices: [{ name: "approve" }, { name: "reject" }],
				lockScreen,
			},
		]);
	}
	const fromLockScreen = {
		runId: "run-1",
		stepId: "step-1",
		choice: "approve",
		via: "lock_screen" as const,
	};

	test("goes to a Gate its author marked for it, with one of its choices", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		listed(ports, true);
		await answer(ADA, fromLockScreen);
		expect(ports.turns.taken).toEqual([
			{
				runId: "run-1",
				intent: {
					kind: "answer",
					stepId: "step-1",
					choice: "approve",
					note: "",
					via: "lock_screen",
				},
			},
		]);
		// The rule reads the Gates of the run's own Space.
		expect(ports.gates.asked).toEqual([SPACE]);
	});

	test("needs the app for a Gate not marked for it, or a choice it does not have", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		listed(ports, false);
		expect(await refusalOf(answer(ADA, fromLockScreen))).toBeInstanceOf(
			NeedsApp,
		);
		listed(ports, true);
		expect(
			await refusalOf(answer(ADA, { ...fromLockScreen, choice: "deploy" })),
		).toBeInstanceOf(NeedsApp);
		expect(ports.turns.taken).toEqual([]);
	});

	test("is refused the same way when it came as a Command to this Walker, which skipped the rule", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		listed(ports, false);
		const refused = await refusalOf(
			answer({ ...ADA, door: "command" }, fromLockScreen),
		);
		expect(refused).toBeInstanceOf(NeedsApp);
		expect((refused as NeedsApp).message).toBe(
			"Open this Gate in Night Shift to answer it.",
		);
		expect(ports.turns.taken).toEqual([]);
	});

	test("to a Gate that is not open is closed, in the run's own words", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, stateOf({ status: "waiting" }));
		const refused = await refusalOf(answer(ADA, fromLockScreen));
		expect(refused).toBeInstanceOf(GateClosedError);
		expect((refused as GateClosedError).message).toBe(
			"This run does not wait at a Gate.",
		);
	});

	test("with an answer on its way is closed, and does not travel", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1", walkerId: FAR }, waiting);
		ports.gates.setOpen(SPACE, [
			{
				...openGate(SPACE, "run-1", 1, "step-1"),
				choices: [{ name: "approve" }],
				lockScreen: true,
				answerPending: true,
			},
		]);
		const refused = await refusalOf(answer(ADA, fromLockScreen));
		expect(refused).toBeInstanceOf(GateClosedError);
		expect((refused as GateClosedError).message).toBe(
			"This Gate does not wait anymore.",
		);
		expect(ports.walkers.sent).toEqual([]);
	});

	test("an answer from the app needs no mark", async () => {
		const { ports, answer } = setup();
		ports.put({ id: "run-1" }, waiting);
		listed(ports, false);
		await answer(ADA, { ...fromLockScreen, via: "phone" });
		expect(ports.turns.taken).toHaveLength(1);
		expect(ports.gates.asked).toEqual([]);
	});
});
