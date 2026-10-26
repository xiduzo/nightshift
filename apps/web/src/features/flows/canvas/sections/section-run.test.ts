import { describe, expect, test } from "bun:test";
import type { NodeRunState } from "../flow-node";
import { sectionRunSummary } from "./section-run";

const states = new Map<string, NodeRunState>([
	["build", { state: "pass", visits: 2 }],
	["stack", { state: "fail", visits: 1 }],
	["scope", { state: "running", visits: 1 }],
	["human", { state: "waiting", visits: 1 }],
]);

describe("sectionRunSummary", () => {
	test("counts the members that run, wait, failed, and were reached", () => {
		const summary = sectionRunSummary(
			["build", "stack", "scope", "other"],
			states,
			["build", "stack", "build", "scope"],
		);
		expect(summary).toEqual({
			now: { nodeId: "scope", state: "running" },
			latest: { nodeId: "scope", state: "running" },
			running: ["scope"],
			waiting: [],
			failed: ["stack"],
			reached: 3,
		});
	});

	test("the member that runs now is the last active one to start", () => {
		const summary = sectionRunSummary(["scope", "human"], states, [
			"scope",
			"human",
		]);
		expect(summary.now).toEqual({ nodeId: "human", state: "waiting" });
		expect(summary.waiting).toEqual(["human"]);
	});

	test("a Section the run left takes the state of its last step", () => {
		const summary = sectionRunSummary(["build", "stack"], states, [
			"stack",
			"build",
			"scope",
		]);
		expect(summary.now).toBeNull();
		expect(summary.latest).toEqual({ nodeId: "build", state: "pass" });
	});

	test("a Section the run never reached", () => {
		expect(sectionRunSummary(["a", "b"], states, ["build"])).toEqual({
			now: null,
			latest: null,
			running: [],
			waiting: [],
			failed: [],
			reached: 0,
		});
	});
});
