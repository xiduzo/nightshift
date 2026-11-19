import { describe, expect, test } from "bun:test";
import { RunRefusal, whyNot } from "../../run-status";
import {
	ANSWER_ON_ITS_WAY,
	type Choice,
	closedWhy,
	GATE_GONE,
	GateClosedError,
	type GatedRun,
	NO_GATE,
	NOT_THE_GATE,
	refuseAnswer,
} from "./answer";

/** A run that waits at its Gate on `step-1`, with a form when given one. */
const waiting = (
	form: string | null = null,
	choices: readonly Choice[] = [{ name: "approve" }, { name: "reject" }],
): GatedRun<string> => ({
	status: "waiting",
	gate: { stepId: "step-1", choices, form },
});

/** The form check of a test: "ok" fills the form. */
const askProblem = (_form: string, data: unknown) =>
	data === "ok" ? null : "Fill in the form to answer.";

/** What `refuseAnswer` throws, or null. */
function refusalOf(
	run: GatedRun<string>,
	answer: Parameters<typeof refuseAnswer>[1],
) {
	try {
		refuseAnswer(run, answer, askProblem);
		return null;
	} catch (error) {
		return error as RunRefusal;
	}
}

describe("the words of a closed Gate", () => {
	test("are whole", () => {
		expect(NO_GATE).toBe("This run does not wait at a Gate.");
		expect(NOT_THE_GATE).toBe("That step is not the open Gate of this run.");
		expect(ANSWER_ON_ITS_WAY).toBe(
			"An answer to this Gate is already on its way to the device that runs it.",
		);
		expect(GATE_GONE).toBe("This Gate does not wait anymore.");
	});
});

describe("closedWhy", () => {
	test("is null for the open Gate of the step", () => {
		expect(closedWhy(waiting(), "step-1")).toBeNull();
	});

	test("says why a run that waits at no Gate, or at another step's, takes no answer", () => {
		expect(closedWhy({ status: "waiting", gate: null }, "step-1")).toBe(
			NO_GATE,
		);
		expect(closedWhy(waiting(), "step-2")).toBe(NOT_THE_GATE);
		// The status rule's own words first.
		expect(closedWhy({ status: "stopped", gate: null }, "step-1")).toBe(
			whyNot("answer", "stopped", true),
		);
	});
});

describe("refuseAnswer", () => {
	test("takes one of the Gate's choices", () => {
		expect(
			refusalOf(waiting(), { stepId: "step-1", choice: "approve" }),
		).toBeNull();
	});

	test("refuses an answer to a Gate that does not wait as closed", () => {
		const refused = refusalOf(
			{ status: "waiting", gate: null },
			{ stepId: "step-1", choice: "approve" },
		);
		expect(refused).toBeInstanceOf(GateClosedError);
		expect(refused?.message).toBe(NO_GATE);
		expect(refused?.rule).toBe("gate-closed");
		expect(
			refusalOf(waiting(), { stepId: "step-2", choice: "approve" })?.message,
		).toBe(NOT_THE_GATE);
	});

	test("refuses a choice that is not an option", () => {
		const refused = refusalOf(waiting(), { stepId: "step-1", choice: "maybe" });
		expect(refused).toBeInstanceOf(RunRefusal);
		expect(refused?.rule).toBe("invalid-answer");
		expect(refused?.message).toBe(
			'"maybe" is not an option of this node. Choose one of: approve, reject.',
		);
	});

	test("refuses a choice that needs a note without one", () => {
		const run = waiting(null, [{ name: "revise", needsNote: true }]);
		expect(
			refusalOf(run, { stepId: "step-1", choice: "revise", note: "  " })
				?.message,
		).toBe('Write a note to choose "revise". The agent continues with it.');
		expect(
			refusalOf(run, { stepId: "step-1", choice: "revise", note: "Fix it" }),
		).toBeNull();
	});

	test("refuses data that does not fill an Ask's form", () => {
		const run = waiting("form");
		expect(
			refusalOf(run, { stepId: "step-1", choice: "approve", data: "no" })
				?.message,
		).toBe("Fill in the form to answer.");
		expect(
			refusalOf(run, { stepId: "step-1", choice: "approve", data: "ok" }),
		).toBeNull();
	});

	test("refuses too many files", () => {
		const files = Array.from({ length: 11 }, (_, i) => ({
			name: `f${i}.txt`,
			mediaType: "text/plain",
			content: "aGk=",
		}));
		const refused = refusalOf(waiting(), {
			stepId: "step-1",
			choice: "approve",
			files,
		});
		expect(refused?.rule).toBe("invalid-answer");
		expect(refused?.message).toBe("Add at most 10 files.");
	});
});
