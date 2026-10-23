/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
	type ContextItem,
	parseGateQuestion,
	type RunDetail,
} from "@nightshift/client";
import { nextEdge } from "@nightshift/flows";

import {
	choiceRoutes,
	needsConfirm,
	openLinkText,
	questionSections,
	routeText,
	sentText,
	stepsHint,
} from "./gate-view";

/** A run whose flow has a Gate `review`: approve goes to `build`, reject ends, retry loops back once. */
function run(fields: Partial<RunDetail> = {}): RunDetail {
	return {
		flow: {
			nodes: [{ id: "plan" }, { id: "review" }, { id: "build" }],
			edges: [
				{ id: "e1", from: "review", outcome: "approve", to: "build" },
				{ id: "e2", from: "review", outcome: "retry", to: "plan", max: 1 },
			],
		},
		traversals: {},
		steps: [{ id: "s2", nodeId: "review", scope: null }],
		...fields,
	} as unknown as RunDetail;
}

const labels = new Map([
	["plan", "Plan"],
	["build", "Build it"],
]);
const choices = [{ name: "approve" }, { name: "reject" }, { name: "retry" }];

describe("choiceRoutes", () => {
	test("each choice leads where the flow's edges say", () => {
		const routes = choiceRoutes(
			run(),
			{ stepId: "s2", nodeId: "review" },
			choices,
			labels,
		);
		expect(routes.get("approve")).toEqual({
			kind: "node",
			nodeId: "build",
			label: "Build it",
		});
		expect(routes.get("reject")).toEqual({ kind: "end" });
		expect(routes.get("retry")).toEqual({
			kind: "node",
			nodeId: "plan",
			label: "Plan",
		});
	});

	test("a path the run took its most times stops the run", () => {
		const routes = choiceRoutes(
			run({ traversals: { e2: 1 } }),
			{ stepId: "s2", nodeId: "review" },
			choices,
			labels,
		);
		expect(routes.get("retry")).toEqual({ kind: "limit" });
	});

	test("a node without a label goes by its id", () => {
		const routes = choiceRoutes(
			run(),
			{ stepId: "s2", nodeId: "review" },
			[{ name: "approve" }],
			new Map(),
		);
		expect(routes.get("approve")).toMatchObject({ label: "build" });
	});

	test("nothing while the run loads, or for a Gate in a called flow", () => {
		expect(
			choiceRoutes(
				undefined,
				{ stepId: "s2", nodeId: "review" },
				choices,
				labels,
			).size,
		).toBe(0);
		const called = run({
			steps: [
				{
					id: "s9",
					nodeId: "review",
					scope: { parentStepId: "s1", itemId: null },
				},
			] as unknown as RunDetail["steps"],
		});
		expect(
			choiceRoutes(called, { stepId: "s9", nodeId: "review" }, choices, labels)
				.size,
		).toBe(0);
		expect(
			choiceRoutes(
				run(),
				{ stepId: "s3", nodeId: "elsewhere" },
				choices,
				labels,
			).size,
		).toBe(0);
	});
});

describe("the engine's edge rule", () => {
	test("choiceRoutes takes the edge the engine takes", () => {
		for (const traversals of [{}, { e2: 1 }] as Record<string, number>[]) {
			const detail = run({ traversals });
			const routes = choiceRoutes(
				detail,
				{ stepId: "s2", nodeId: "review" },
				choices,
				labels,
			);
			for (const { name } of choices) {
				const engine = nextEdge({
					flow: detail.flow,
					from: "review",
					outcome: name,
					traversals,
				});
				const route = routes.get(name);
				expect(route?.kind).toBe(
					engine.kind === "edge"
						? "node"
						: engine.kind === "end"
							? "end"
							: "limit",
				);
				if (engine.kind === "edge" && route?.kind === "node") {
					expect(route.nodeId).toBe(engine.edge.to);
				}
			}
		}
	});
});

describe("routeText and needsConfirm", () => {
	test("says where a choice leads", () => {
		expect(routeText({ kind: "node", nodeId: "build", label: "Build" })).toBe(
			"Goes to Build",
		);
		expect(routeText({ kind: "end" })).toBe("Ends the run");
		expect(routeText({ kind: "limit" })).toContain("limit");
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
			{ label: "Diff", kind: "code", value: "- a\n+ b" },
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
