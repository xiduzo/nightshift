/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { RunStatus } from "@nightshift/client";

import {
	gateLook,
	NEEDS_YOU,
	outcomeLook,
	runStatusLook,
	stepKind,
	stepLook,
	TONE_CLASS,
} from "./looks";

const STATUSES: RunStatus[] = [
	"running",
	"waiting",
	"sleeping",
	"finished",
	"stopped",
	"failed",
	"interrupted",
];

describe("runStatusLook", () => {
	test("each status takes its own tone, an icon and its word", () => {
		for (const status of STATUSES) {
			const look = runStatusLook(status);
			expect(look.tone).toBe(status);
			expect(look.label.length).toBeGreaterThan(0);
		}
		expect(runStatusLook("running")).toEqual({
			tone: "running",
			icon: "loader",
			label: "Running",
		});
		expect(runStatusLook("failed").icon).toBe("circle-x");
	});

	test("a run an End node ended with nothing to do reads as such; other results keep the status", () => {
		expect(runStatusLook("finished", "nothing-to-do")).toEqual({
			tone: "neutral",
			icon: "circle-dashed",
			label: "Nothing to do",
		});
		expect(runStatusLook("finished", "done")).toEqual(
			runStatusLook("finished"),
		);
		expect(runStatusLook("failed", "failed")).toEqual(runStatusLook("failed"));
	});
});

describe("outcomeLook", () => {
	test("pass, fail and needs input have a fixed look", () => {
		expect(outcomeLook("pass")).toEqual({
			tone: "pass",
			icon: "circle-check",
			label: "Pass",
		});
		expect(outcomeLook("fail").tone).toBe("fail");
		expect(outcomeLook("needs-input").label).toBe("Needs input");
	});

	test("an error is a failure: its own icon, the failed tone and a word", () => {
		expect(outcomeLook("error")).toEqual({
			tone: "failed",
			icon: "triangle-alert",
			label: "Error",
		});
	});

	test("an outcome Night Shift names without a look of its own reads as a word", () => {
		expect(outcomeLook("timeout")).toEqual({
			tone: "label",
			icon: "circle-dot",
			label: "Timed out",
		});
	});

	test("any other outcome shows its own name", () => {
		expect(outcomeLook("approve")).toEqual({
			tone: "label",
			icon: "circle-dot",
			label: "approve",
		});
		// Not a key of Object.prototype either.
		expect(outcomeLook("constructor").label).toBe("constructor");
	});
});

describe("stepLook", () => {
	test("a step that has not ended runs, or sleeps in a sleeping run", () => {
		expect(stepLook({ state: "running", outcome: null }).label).toBe("Running");
		expect(
			stepLook(
				{ state: "running", outcome: null, nodeType: "wait" },
				"sleeping",
			).tone,
		).toBe("sleeping");
		expect(
			stepLook(
				{ state: "running", outcome: null, nodeType: "call" },
				"sleeping",
			).tone,
		).toBe("running");
	});

	test("an open Gate waits for you", () => {
		expect(stepLook({ state: "waiting", outcome: null })).toEqual({
			tone: "waiting",
			icon: "hand",
			label: "Waiting for you",
		});
	});

	test("an ended step shows how it ended", () => {
		expect(stepLook({ state: "failed", outcome: null }).tone).toBe("failed");
		expect(stepLook({ state: "stopped", outcome: "stopped" }).tone).toBe(
			"stopped",
		);
		expect(stepLook({ state: "stopped", outcome: "interrupted" }).tone).toBe(
			"interrupted",
		);
		expect(stepLook({ state: "done", outcome: "pass" }).label).toBe("Pass");
		expect(stepLook({ state: "done", outcome: "error" }).label).toBe("Error");
		expect(stepLook({ state: "done", outcome: "ship" }).label).toBe("ship");
		expect(stepLook({ state: "done", outcome: null }).label).toBe("Done");
	});
});

describe("stepKind", () => {
	test("names each node type as the flow editor does", () => {
		expect(stepKind({ nodeType: "agent", gate: null })).toEqual({
			label: "Agent",
			icon: "bot",
		});
		expect(stepKind({ nodeType: "call", gate: null }).label).toBe("Subflow");
		expect(stepKind({ nodeType: "decision", gate: null }).label).toBe(
			"Decision",
		);
	});

	test("a Decision that asks a person is a Gate", () => {
		const gate = {
			question: "Ship it?",
			choices: [],
			openedAt: 0,
			deadline: null,
		};
		expect(stepKind({ nodeType: "decision", gate })).toEqual({
			label: "Gate",
			icon: "hand",
		});
	});
});

describe("TONE_CLASS", () => {
	test("every tone has a text color and a badge tint", () => {
		for (const [tone, classes] of Object.entries(TONE_CLASS)) {
			expect(classes.text.startsWith("text-")).toBe(true);
			expect(classes.badge.length).toBeGreaterThan(0);
			if (tone !== "neutral") expect(classes.badge).toContain(tone);
		}
	});
});

describe("gateLook", () => {
	test("a Gate you may answer needs you", () => {
		expect(gateLook({ canAnswer: true, answerPending: false })).toEqual(
			NEEDS_YOU,
		);
	});

	test("a Gate you may only read, or one answered, says so in a word", () => {
		expect(gateLook({ canAnswer: false, answerPending: false })).toEqual({
			tone: "neutral",
			icon: "hand",
			label: "Waits for another person",
		});
		expect(gateLook({ canAnswer: true, answerPending: true })).toEqual({
			tone: "neutral",
			icon: "circle-check",
			label: "Answer on its way",
		});
		expect(gateLook({ canAnswer: false, answerPending: true }).label).toBe(
			"Answer on its way",
		);
	});
});
