/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { captionParts, rowLabel } from "./caption";

describe("captionParts", () => {
	test("keeps the parts in order and leaves out the empty ones", () => {
		expect(captionParts("website")).toEqual(["website"]);
		expect(
			captionParts([
				{ text: "Running", tone: "running" },
				"website",
				"",
				{ text: "build", mono: true },
			]),
		).toEqual([
			{ text: "Running", tone: "running" },
			"website",
			{ text: "build", mono: true },
		]);
		expect(captionParts(undefined)).toEqual([]);
		expect(captionParts(["  "])).toEqual([]);
	});
});

describe("rowLabel", () => {
	test("reads a word once when the icon and the caption both say it", () => {
		expect(
			rowLabel({
				iconLabel: "Failed",
				title: "release",
				caption: [{ text: "Failed", tone: "failed" }, "website"],
			}),
		).toBe("Failed, release, website");
	});

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

	test("reads a status line after the title", () => {
		expect(
			rowLabel({
				title: "website",
				status: "2 Gates need you",
				caption: "Last run 3 h ago",
			}),
		).toBe("website, 2 Gates need you, Last run 3 h ago");
	});

	test("takes the value as it shows when it has no spoken form", () => {
		expect(rowLabel({ title: "Runs", value: "12" })).toBe("Runs, 12");
	});
});
