/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { OpenGate } from "@nightshift/client";

import { choicesText, gateRowText, nextGate } from "./gate-list";

const MIN = 60_000;

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
			waited: "12 min",
			pullRequest: false,
		});
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
