import { describe, expect, test } from "bun:test";
import { RunRefusal } from "../../../run-status";
import {
	RESUME_ON_ITS_WAY,
	refuseRelease,
	refuseRestart,
	refuseSignal,
	stopAfterStepEvent,
	stopTravels,
	takenOverBefore,
} from "./action-rules";

/** The rules of what a person does to a run, past its status. */

/** What a rule throws, or null. */
function refusalOf(rule: () => void): RunRefusal | null {
	try {
		rule();
		return null;
	} catch (error) {
		if (error instanceof RunRefusal) return error;
		throw error;
	}
}

describe("a Signal", () => {
	/** The waits of a run: one per name, `{}` for a wait on no signal. */
	const waits = (...signals: (string | undefined)[]) =>
		signals.map((signal) => ({
			payload: signal === undefined ? {} : { signal },
		}));

	test("goes to a run that sleeps for a Signal of that name", () => {
		expect(
			refusalOf(() =>
				refuseSignal({ status: "sleeping", waits: waits("go") }, "go"),
			),
		).toBeNull();
	});

	test("goes to a run that waits at a Gate beside a Wait for that Signal, or sleeps beside another sleep", () => {
		expect(
			refusalOf(() =>
				refuseSignal({ status: "waiting", waits: waits("go") }, "go"),
			),
		).toBeNull();
		expect(
			refusalOf(() =>
				refuseSignal(
					{ status: "sleeping", waits: waits("go", undefined) },
					"go",
				),
			),
		).toBeNull();
	});

	test("to a run that waits for another name, for none, or only at a Gate, is the wrong Signal", () => {
		for (const [status, sleeping] of [
			["sleeping", waits("stop")],
			["sleeping", waits(undefined)],
			["waiting", waits()],
		] as const) {
			const refused = refusalOf(() =>
				refuseSignal({ status, waits: sleeping }, "go"),
			);
			expect(refused?.rule).toBe("wrong-signal");
			expect(refused?.message).toBe("This run does not wait for that signal.");
		}
	});

	test("to a run whose status takes none is refused by the status rule", () => {
		const refused = refusalOf(() =>
			refuseSignal({ status: "running", waits: waits("go") }, "go"),
		);
		expect(refused?.rule).toBe("not-now");
	});
});

describe("a release of a lease", () => {
	test("lets go of a lease the run holds", () => {
		expect(
			refusalOf(() =>
				refuseRelease({ holds: [{ kind: "lease", name: "deploy" }] }, "deploy"),
			),
		).toBeNull();
	});

	test("of a lease the run does not hold, or a service of that name, is refused", () => {
		for (const holds of [
			[],
			[{ kind: "lease", name: "other" }],
			[{ kind: "service", name: "deploy" }],
		]) {
			const refused = refusalOf(() => refuseRelease({ holds }, "deploy"));
			expect(refused?.rule).toBe("not-now");
			expect(refused?.message).toBe(
				'This run does not hold the lease "deploy" now.',
			);
		}
	});
});

describe("a restart", () => {
	const running = { status: "running" as const, end: null };
	const steps = [
		{ id: "step-1", endedAt: 10 },
		{ id: "step-2", endedAt: null },
	];

	test("restarts the step that runs, named or not", () => {
		expect(
			refusalOf(() => refuseRestart(running, steps, undefined)),
		).toBeNull();
		expect(refusalOf(() => refuseRestart(running, steps, "step-2"))).toBeNull();
	});

	test("while no step runs is refused: try again when the next one starts", () => {
		const refused = refusalOf(() =>
			refuseRestart(running, [{ id: "step-1", endedAt: 10 }], undefined),
		);
		expect(refused?.rule).toBe("no-step");
		expect(refused?.message).toBe(
			"No step runs right now. Try again when the next step starts.",
		);
	});

	test("of a step that ended is refused: restart the one that runs", () => {
		const refused = refusalOf(() => refuseRestart(running, steps, "step-1"));
		expect(refused?.rule).toBe("step-ended");
		expect(refused?.message).toBe(
			"That step has ended. Restart the step that runs now.",
		);
	});

	test("of a run whose status takes none is refused by the status rule", () => {
		const refused = refusalOf(() =>
			refuseRestart({ status: "stopped", end: null }, steps, undefined),
		);
		expect(refused?.rule).toBe("not-now");
	});
});

describe("a take-over", () => {
	const taken = (seq: number, stepId: string, by: string | null) => ({
		seq,
		stepId,
		payload: { by },
	});

	test("counts once per step and person in the current walk", () => {
		const run = { walk: { seq: 5 }, takeOvers: [taken(7, "step-1", "ada")] };
		expect(takenOverBefore(run, "step-1", "ada")).toBe(true);
		expect(takenOverBefore(run, "step-1", "bob")).toBe(false);
		expect(takenOverBefore(run, "step-2", "ada")).toBe(false);
	});

	test("of an earlier walk counts no more after a resume", () => {
		const run = { walk: { seq: 9 }, takeOvers: [taken(7, "step-1", "ada")] };
		expect(takenOverBefore(run, "step-1", "ada")).toBe(false);
	});

	test("without a walk counts every take-over of the run", () => {
		const run = { walk: null, takeOvers: [taken(1, "step-1", null)] };
		expect(takenOverBefore(run, "step-1", null)).toBe(true);
	});
});

describe("a stop after the running step", () => {
	test("is requested, or withdrawn, once", () => {
		const running = { status: "running" as const, stopAfterStep: false };
		expect(stopAfterStepEvent(running, true)).toBe("StopAfterStepRequested");
		expect(stopAfterStepEvent(running, false)).toBeNull();
		const asked = { status: "running" as const, stopAfterStep: true };
		expect(stopAfterStepEvent(asked, false)).toBe("StopAfterStepCancelled");
		expect(stopAfterStepEvent(asked, true)).toBeNull();
	});

	test("of a run that has ended logs nothing", () => {
		expect(
			stopAfterStepEvent({ status: "finished", stopAfterStep: false }, true),
		).toBeNull();
	});
});

describe("a stop of a run another Device walks", () => {
	test("travels while the run goes on, and not once it ended", () => {
		expect(stopTravels({ status: "waiting" })).toBe(true);
		expect(stopTravels({ status: "finished" })).toBe(false);
	});
});

test("a resume on its way says so", () => {
	expect(RESUME_ON_ITS_WAY).toBe(
		"A resume of this run is already on its way to the device that runs it.",
	);
});
