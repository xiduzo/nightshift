import { describe, expect, test } from "bun:test";

import type { RunDetail } from "../runs";
import {
	choiceRoutes,
	confirmText,
	isDestructive,
	needsConfirm,
	routeNote,
	routeText,
	sentText,
} from "./routes";

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
const gate = { stepId: "s2", nodeId: "review" };

describe("choiceRoutes", () => {
	test("each choice leads where the flow's edges say", () => {
		const routes = choiceRoutes(run(), gate, choices, labels);
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
			gate,
			choices,
			labels,
		);
		expect(routes.get("retry")).toEqual({ kind: "limit" });
	});

	test("an Agent that asks: the answer goes back to it, stop takes its fail edge", () => {
		const asks = run({
			flow: {
				nodes: [{ id: "build", type: "agent" }, { id: "plan" }],
				edges: [{ id: "e1", from: "build", outcome: "fail", to: "plan" }],
			},
			steps: [{ id: "s1", nodeId: "build", scope: null }],
		} as unknown as Partial<RunDetail>);
		const routes = choiceRoutes(
			asks,
			{ stepId: "s1", nodeId: "build" },
			[{ name: "answer", needsNote: true }, { name: "stop" }],
			labels,
		);
		expect(routes.has("answer")).toBe(false);
		expect(routes.get("stop")).toEqual({
			kind: "node",
			nodeId: "plan",
			label: "Plan",
		});
	});

	test("a node without a label goes by its id", () => {
		const routes = choiceRoutes(run(), gate, [{ name: "approve" }], new Map());
		expect(routes.get("approve")).toMatchObject({ label: "build" });
	});

	test("nothing while the run loads, or for a Gate in a called flow", () => {
		expect(choiceRoutes(undefined, gate, choices, labels).size).toBe(0);
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
		expect(isDestructive({ color: "red" })).toBe(true);
		expect(isDestructive({})).toBe(false);
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
			title: "Sign off on approve?",
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
		).toBe("Fix login continues at Build.");
		expect(sentText(undefined, "Fix login", null)).toBe("Fix login continues.");
		expect(
			sentText(
				{ kind: "node", nodeId: "a", label: "Announce it?" },
				"Ship",
				null,
			),
		).toBe("Ship continues at Announce it?");
		expect(sentText(undefined, "Fix login", "Mac mini")).toBe(
			"Fix login continues when Mac mini is online.",
		);
		expect(sentText({ kind: "end" }, "Fix login", null)).toBe("The run ends.");
		expect(sentText({ kind: "limit" }, "Fix login", null)).toBe(
			"The run stops.",
		);
	});
});
