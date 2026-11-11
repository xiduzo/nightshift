/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate } from "@nightshift/client";

import { briefView, choiceLine } from "./brief-view";

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
		});
		expect(view.situation).toBeNull();
		expect(view.background).toBeNull();
		expect(view.recommendation).toBeNull();
	});

	test("a reason without an option still shows", () => {
		const view = briefView({
			brief: brief({ recommendation: { option: null, reason: "Wait." } }),
		});
		expect(view.recommendation).toEqual({
			option: null,
			reason: "Wait.",
			byModel: false,
		});
	});

	test("a Host older than the brief: nothing to show", () => {
		expect(briefView({})).toEqual({
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
