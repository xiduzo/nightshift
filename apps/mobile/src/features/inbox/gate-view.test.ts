/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { type ContextItem, parseGateQuestion } from "@nightshift/client";

import {
	confirmText,
	needsConfirm,
	openLinkText,
	questionSections,
	routeNote,
	routeText,
	sentText,
	stepsHint,
} from "./gate-view";

describe("routeText and needsConfirm", () => {
	test("says where a choice leads", () => {
		expect(routeText({ kind: "node", nodeId: "build", label: "Build" })).toBe(
			"Goes to Build",
		);
		expect(routeText({ kind: "end" })).toBe("Ends the run");
		expect(routeText({ kind: "limit" })).toBe("Stops the run");
		expect(routeNote({ kind: "limit" })).toBe("This path reached its limit.");
		expect(routeNote({ kind: "end" })).toBeNull();
		expect(routeText(undefined)).toBeNull();
	});

	test("a red choice, or one that ends the run, asks first", () => {
		const goes = { kind: "node", nodeId: "b", label: "B" } as const;
		expect(needsConfirm({}, goes)).toBe(false);
		expect(needsConfirm({ color: "red" }, goes)).toBe(true);
		expect(needsConfirm({ color: "green" }, { kind: "end" })).toBe(true);
		expect(needsConfirm({}, { kind: "limit" })).toBe(true);
		expect(needsConfirm({}, undefined)).toBe(false);
	});
});

describe("confirmText", () => {
	test("ending and stopping the run are two things", () => {
		expect(confirmText({ kind: "end" }, "reject", "Fix login")).toEqual({
			title: "End the run?",
			body: "This answer ends the run Fix login.",
		});
		const stop = confirmText({ kind: "limit" }, "retry", "Fix login");
		expect(stop.title).toBe("Stop the run?");
		expect(stop.body).toContain("stops the run Fix login");
		expect(
			confirmText(
				{ kind: "node", nodeId: "b", label: "Build" },
				"approve",
				"Fix login",
			),
		).toEqual({
			title: "Send approve?",
			body: "Goes to Build in the run Fix login.",
		});
		expect(confirmText(undefined, "approve", "Fix login").body).toBe(
			"The run Fix login gets this answer.",
		);
	});
});

describe("sentText", () => {
	test("what the run does after your answer", () => {
		expect(
			sentText(
				{ kind: "node", nodeId: "b", label: "Build" },
				"Fix login",
				null,
			),
		).toBe("Fix login goes on at Build.");
		expect(sentText(undefined, "Fix login", null)).toBe("Fix login goes on.");
		expect(
			sentText(
				{ kind: "node", nodeId: "a", label: "Announce it?" },
				"Ship",
				null,
			),
		).toBe("Ship goes on at Announce it?");
		expect(sentText(undefined, "Fix login", "Mac mini")).toBe(
			"Fix login goes on when Mac mini is online.",
		);
		expect(sentText({ kind: "end" }, "Fix login", null)).toBe("The run ends.");
		expect(sentText({ kind: "limit" }, "Fix login", null)).toBe(
			"The run stops.",
		);
	});
});

describe("questionSections", () => {
	test("splits the rest of the question, short facts and long parts", () => {
		const { context } = parseGateQuestion(
			[
				"Ship the fix?",
				"The tests pass on the branch.",
				"Branch:\nfix/login",
				"Plan:\nFirst we change the form.\nThen we change the server.",
				"Diff:",
				"```diff\n- a\n+ b\n```",
			].join("\n\n"),
		);
		const sections = questionSections(context);
		expect(sections.body).toEqual(["The tests pass on the branch."]);
		expect(sections.glance).toEqual([{ label: "Branch", value: "fix/login" }]);
		expect(sections.sections).toEqual([
			{
				label: "Plan",
				kind: "text",
				value: "First we change the form.\nThen we change the server.",
			},
			{ label: "Diff", kind: "code", language: "diff", value: "- a\n+ b" },
		]);
	});

	test("JSON shows as code with its language, Markdown stays one text", () => {
		const { context } = parseGateQuestion(
			[
				"Ship **the fix**?",
				"## Why\n\n- tests pass\n- review done",
				'Result: {"ok": true}',
			].join("\n\n"),
		);
		const sections = questionSections(context);
		expect(sections.body).toEqual(["## Why\n\n- tests pass\n- review done"]);
		expect(sections.sections).toEqual([
			{
				label: "Result",
				kind: "code",
				language: "json",
				value: '{\n  "ok": true\n}',
			},
		]);
	});

	test("code without a label is Code", () => {
		const item: ContextItem = { label: null, kind: "code", value: "x" };
		expect(questionSections([item]).sections[0]?.label).toBe("Code");
	});
});

describe("labels", () => {
	test("the steps hint leaves out what it does not know", () => {
		expect(stepsHint(4, "12 min", "$0.40")).toBe("4 steps · 12 min · $0.40");
		expect(stepsHint(1, null, null)).toBe("1 step");
	});

	test("a GitHub link opens on GitHub", () => {
		expect(
			openLinkText({ url: "https://github.com/a/b/pull/1", kind: "pull" }),
		).toBe("Open on GitHub");
		expect(openLinkText({ url: "https://example.com", kind: "web" })).toBe(
			"Open in the browser",
		);
	});
});
