/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { formatTime, type OpenGate } from "@nightshift/client";

import { choicesText, gateRowText, nextGate } from "./gate-list";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function gate(fields: Partial<OpenGate>): OpenGate {
	return {
		spaceId: "home",
		spaceName: "Home",
		runId: "r1",
		runTitle: "Feature factory · Fix login",
		flowName: "Feature factory",
		projectId: "web",
		projectName: "website",
		stepId: "s1",
		nodeId: "review",
		question: "Review the plan?",
		choices: [{ name: "approve" }, { name: "reject", color: "red" }],
		lockScreen: false,
		openedAt: 0,
		walker: { thisDevice: true, name: null },
		answerPending: false,
		canAnswer: true,
		...fields,
	} as OpenGate;
}

const a = gate({ runId: "a", openedAt: 1 * MIN });
const b = gate({
	runId: "b",
	openedAt: 2 * MIN,
	projectId: "api",
	projectName: "api",
});
const c = gate({ runId: "c", openedAt: 3 * MIN });

describe("gateRowText", () => {
	test("project and flow, the headline, the choices and how long it waited", () => {
		const row = gateRowText(
			gate({
				question: "Ship the fix?\n\nBranch:\nfix/login",
				openedAt: 0,
			}),
			12 * MIN,
		);
		expect(row).toEqual({
			overline: "website · Feature factory",
			title: "Ship the fix?",
			choices: "2 choices",
			nodeId: "review",
			situation: "",
			waited: "12 min",
			due: null,
			pullRequest: false,
		});
	});

	test("the situation of the brief on one line, before the question", () => {
		const row = gateRowText(
			gate({
				question: "Ship the fix?\n\nThe tests pass.",
				brief: {
					urgencyBy: "flow",
					situation: "\nThe **release** waits for this.\nIt goes out at noon.",
					background: [],
					recommendation: null,
					byModel: [],
				},
			}),
			0,
		);
		expect(row.situation).toBe("The release waits for this.");
	});

	test("without a situation: the first line of the question below its title", () => {
		const row = gateRowText(
			gate({ question: "Ship the fix?\n\nThe *tests* pass.\nAll 12." }),
			0,
		);
		expect(row.situation).toBe("The tests pass.");
	});

	test("a Host without the brief, and a question of one line: no situation", () => {
		expect(gateRowText(gate({}), 0).situation).toBe("");
	});

	test("a Gate with a deadline says when it needs an answer", () => {
		const now = 1_800_000_000_000;
		const today = gateRowText(
			gate({ deadline: { at: now, choose: "keep" } }),
			now,
		);
		expect(today.due).toBe(`by ${formatTime(now)}`);
		const later = gateRowText(
			gate({ deadline: { at: now + 3 * DAY, choose: "keep" } }),
			now,
		);
		expect(later.due).toStartWith(`by ${formatTime(now + 3 * DAY)} on `);
	});

	test("the headline shows without Markdown marks", () => {
		const row = gateRowText(
			gate({ question: "**Ship** the [fix](https://x)?" }),
			0,
		);
		expect(row.title).toBe("Ship the fix?");
	});

	test("a Gate that links a pull request shows its icon", () => {
		const row = gateRowText(
			gate({
				question:
					"Merge it?\n\nPull request: https://github.com/acme/web/pull/7",
			}),
			0,
		);
		expect(row.pullRequest).toBe(true);
	});

	test("a quick run", () => {
		expect(gateRowText(gate({ flowName: null }), 0).overline).toBe(
			"website · Quick run",
		);
	});

	test("one choice, many choices", () => {
		expect(choicesText(1)).toBe("1 choice");
		expect(choicesText(3)).toBe("3 choices");
	});
});

describe("nextGate", () => {
	test("the oldest other Gate you may answer", () => {
		const readOnly = gate({ runId: "x", openedAt: 0, canAnswer: false });
		const pending = gate({ runId: "y", openedAt: 0, answerPending: true });
		expect(nextGate([readOnly, pending, a, b, c], a)?.runId).toBe("b");
		expect(nextGate([a], a)).toBeNull();
	});
});
