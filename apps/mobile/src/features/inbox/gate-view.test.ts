/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
	type ContextItem,
	type OpenGate,
	parseGateQuestion,
} from "@nightshift/client";

import {
	openLinkText,
	questionSections,
	stepsHint,
	urgentText,
} from "./gate-view";

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
				// One fact per line keeps its line: a Markdown hard break.
				value: "First we change the form.  \nThen we change the server.",
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

describe("urgentText", () => {
	const MIN = 60_000;
	const at = 10 * 60 * MIN;

	test("a deadline within the hour counts down in minutes", () => {
		expect(
			urgentText({ deadline: { at, choose: "Keep" } }, at - 14 * MIN),
		).toEqual({
			title: "Answer in 14 min",
			description: "If you do not, Night Shift picks Keep.",
		});
	});

	test("a later deadline gives its time", () => {
		const text = urgentText(
			{ deadline: { at, choose: "Keep" } },
			at - 3 * 60 * MIN,
		);
		expect(text?.title.startsWith("Answer by ")).toBe(true);
	});

	test("a deadline that passed asks for an answer now", () => {
		expect(
			urgentText({ deadline: { at, choose: "Keep" } }, at + MIN)?.title,
		).toBe("Answer now");
	});

	test("an Ask takes its default, or its step fails", () => {
		const deadline = { at, choose: "answer" };
		expect(
			urgentText(
				{ deadline, form: { default: {} } as OpenGate["form"] },
				at - MIN,
			)?.description,
		).toBe("If you do not, Night Shift takes the default.");
		expect(
			urgentText({ deadline, form: {} as OpenGate["form"] }, at - MIN)
				?.description,
		).toBe("If you do not, the step fails.");
	});

	test("a Gate for now without a deadline: the run waits", () => {
		expect(urgentText({ deadline: null, urgency: "now" }, 0)).toEqual({
			title: "This needs you now",
			description: "The run waits until you answer.",
		});
		expect(urgentText({ deadline: null, urgency: "today" }, 0)).toBeNull();
		expect(urgentText({ deadline: null }, 0)).toBeNull();
	});
});
