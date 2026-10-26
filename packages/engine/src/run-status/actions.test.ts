import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";

import {
	type RunAction,
	RunRefusal,
	refuseUnless,
	runActions,
	WALKED_ELSEWHERE,
	whyNot,
} from "./actions";
import type { RunStatus } from "./status";

/** The actions a run allows, as a list, in the order of `RunAction`. */
const allowed = (status: RunStatus, walkedHere: boolean): RunAction[] =>
	Object.entries(runActions(status, walkedHere))
		.filter(([, yes]) => yes)
		.map(([action]) => action as RunAction);

describe("the actions a run allows", () => {
	test("on the computer that walks it", () => {
		expect(allowed("running", true)).toEqual(["stop", "restart"]);
		expect(allowed("waiting", true)).toEqual(["stop", "answer", "move"]);
		expect(allowed("sleeping", true)).toEqual([
			"stop",
			"signal",
			"move",
			"resume",
		]);
		for (const ended of ["stopped", "failed", "interrupted"] as const) {
			expect(allowed(ended, true)).toEqual(["move", "resume", "rerun"]);
		}
		expect(allowed("finished", true)).toEqual(["resume", "rerun"]);
	});

	test("a run an End node ended is only run again, whatever its result", () => {
		const allowedAfter = (
			status: RunStatus,
			result: "done" | "nothing-to-do" | "failed",
		) =>
			Object.entries(runActions(status, true, result))
				.filter(([, yes]) => yes)
				.map(([action]) => action);
		expect(allowedAfter("finished", "done")).toEqual(["rerun"]);
		expect(allowedAfter("finished", "nothing-to-do")).toEqual(["rerun"]);
		expect(allowedAfter("failed", "failed")).toEqual(["rerun"]);
		expect(whyNot("resume", "failed", true, "failed")).toBe(
			"This run ended where its flow ends it. Run it again from a step instead.",
		);
		expect(whyNot("move", "failed", false, "failed")).toBe(
			"This run ended where its flow ends it. Run it again from a step instead.",
		);
	});

	test("on another computer: a stop, an answer, a signal and a move travel to the Walker, nothing else", () => {
		expect(allowed("running", false)).toEqual(["stop"]);
		expect(allowed("waiting", false)).toEqual(["stop", "answer", "move"]);
		expect(allowed("sleeping", false)).toEqual(["stop", "signal", "move"]);
		expect(allowed("failed", false)).toEqual(["move"]);
		expect(allowed("finished", false)).toEqual([]);
	});
});

describe("why a run does not allow an action", () => {
	test("says what to do instead, and nothing when it allows it", () => {
		expect(whyNot("resume", "waiting", true)).toBe(
			"This run waits at a Gate. Answer the Gate, or stop the run first.",
		);
		expect(whyNot("move", "running", true)).toBe(
			"The run is in the middle of a step. Move it when it waits, sleeps or has stopped.",
		);
		expect(whyNot("restart", "finished", true)).toBe(
			"This run has ended. Run it again from a step instead.",
		);
		expect(whyNot("resume", "stopped", true)).toBeNull();
	});

	test("a run another Device walks has one refusal for what only its Walker takes", () => {
		for (const action of ["resume", "restart", "rerun"] as const) {
			expect(whyNot(action, "stopped", false)).toBe(WALKED_ELSEWHERE);
		}
		// What travels to the Walker is refused for its status only.
		expect(whyNot("answer", "running", false)).toBe(
			"This run does not wait at a Gate.",
		);
	});

	test("a refusal names its rule", () => {
		const refusal = (action: RunAction, status: RunStatus, here: boolean) => {
			try {
				refuseUnless(action, status, here);
				return null;
			} catch (error) {
				return error;
			}
		};
		const elsewhere = refusal("rerun", "failed", false);
		expect(elsewhere).toBeInstanceOf(RunRefusal);
		expect((elsewhere as RunRefusal).rule).toBe("walked-elsewhere");
		expect((refusal("move", "finished", false) as RunRefusal).rule).toBe(
			"not-now",
		);
		expect(refusal("stop", "running", false)).toBeNull();
	});
});

describe("a run refusal", () => {
	test("is a Refusal of the kind its rule is, so the API answers with its status", () => {
		let notNow: unknown = null;
		try {
			refuseUnless("stop", "finished", true);
		} catch (error) {
			notNow = error;
		}
		expect(notNow).toBeInstanceOf(Refusal);
		expect(notNow).toMatchObject({ rule: "not-now", kind: "conflict" });
		const kindOf = (rule: ConstructorParameters<typeof RunRefusal>[0]) =>
			new RunRefusal(rule, WALKED_ELSEWHERE).kind;
		expect(kindOf("walked-elsewhere")).toBe("conflict");
		expect(kindOf("invalid-answer")).toBe("invalid");
		expect(kindOf("not-your-device")).toBe("forbidden");
		expect(kindOf("signed-out")).toBe("signed-out");
		expect(kindOf("walker-unreachable")).toBe("unavailable");
	});
});
