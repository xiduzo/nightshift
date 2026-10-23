/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { captionParts, captionText, rowLabel } from "./caption";

describe("captionText", () => {
	test("joins the parts with a dot and leaves out the empty ones", () => {
		expect(captionText("website")).toBe("website");
		expect(
			captionText([
				{ text: "Running", tone: "running" },
				"website",
				"",
				{ text: "build", mono: true },
			]),
		).toBe("Running · website · build");
		expect(captionText(undefined)).toBe("");
		expect(captionParts(["  "])).toEqual([]);
	});
});

describe("rowLabel", () => {
	test("reads the icon's meaning, the title, the captions and the value", () => {
		expect(
			rowLabel({
				iconLabel: "Needs you",
				title: "Review the plan",
				overline: "website · Feature factory",
				caption: ["2 choices", { text: "review", mono: true }],
				value: "12 min",
				valueLabel: "waited 12 min",
			}),
		).toBe(
			"Needs you, Review the plan, website · Feature factory, 2 choices, review, waited 12 min",
		);
	});

	test("takes the value as it shows when it has no spoken form", () => {
		expect(rowLabel({ title: "Runs", value: "12" })).toBe("Runs, 12");
	});
});
