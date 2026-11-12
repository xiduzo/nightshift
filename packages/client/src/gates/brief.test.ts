import { describe, expect, test } from "bun:test";

import { briefView, choiceLine } from "./brief";
import type { OpenGate } from "./types";

type Brief = OpenGate["brief"];

function brief(fields: Partial<Brief>): Brief {
	return {
		urgencyBy: "flow",
		situation: null,
		background: [],
		recommendation: null,
		byModel: [],
		...fields,
	};
}

/** Two options that do not say what they do. */
const plain: { impact?: string }[] = [{}, {}];

describe("briefView", () => {
	test("every part, and the parts Night Shift wrote", () => {
		const view = briefView({
			brief: brief({
				situation: " The release waits for this. ",
				background: [
					{ text: "Tests pass", source: "CI" },
					{ text: "Review done", source: null },
				],
				recommendation: { option: "Ship", reason: "All checks pass." },
				byModel: ["background", "impacts"],
			}),
			choices: [{ impact: "The fix goes live." }, {}],
		});
		expect(view).toEqual({
			situation: { text: "The release waits for this.", byModel: false },
			background: {
				items: [
					{ text: "Tests pass", source: "CI" },
					{ text: "Review done", source: null },
				],
				byModel: true,
			},
			recommendation: {
				option: "Ship",
				reason: "All checks pass.",
				byModel: false,
			},
			impactsByModel: true,
		});
	});

	test("empty parts stay out", () => {
		const view = briefView({
			brief: brief({
				situation: "  ",
				background: [{ text: " ", source: "CI" }],
				recommendation: { option: null, reason: "" },
			}),
			choices: plain,
		});
		expect(view.situation).toBeNull();
		expect(view.background).toBeNull();
		expect(view.recommendation).toBeNull();
	});

	test("a reason without an option still shows", () => {
		const view = briefView({
			brief: brief({ recommendation: { option: null, reason: "Wait." } }),
			choices: plain,
		});
		expect(view.recommendation).toEqual({
			option: null,
			reason: "Wait.",
			byModel: false,
		});
	});

	test("Night Shift wrote what the answers do only when an answer says what it does", () => {
		const wrote = brief({ byModel: ["impacts"] });
		expect(briefView({ brief: wrote, choices: plain }).impactsByModel).toBe(
			false,
		);
		expect(
			briefView({ brief: wrote, choices: [{ impact: " " }] }).impactsByModel,
		).toBe(false);
		expect(
			briefView({ brief: wrote, choices: [{ impact: "It ships." }] })
				.impactsByModel,
		).toBe(true);
	});

	test("a Host older than the brief: nothing to show", () => {
		expect(briefView({ choices: plain })).toEqual({
			situation: null,
			background: null,
			recommendation: null,
			impactsByModel: false,
		});
	});
});

describe("choiceLine", () => {
	test("what happens when you pick it, or else its description", () => {
		expect(
			choiceLine({ impact: "The fix goes live.", description: "Ship it" }),
		).toBe("The fix goes live.");
		expect(choiceLine({ description: "Ship it" })).toBe("Ship it");
		expect(choiceLine({ impact: " " })).toBeNull();
	});
});
