import { describe, expect, test } from "bun:test";
import { askWhy, askWhyAnswer } from "./ask-why";

const project = { id: "p1", repoPath: "/work/app" };
const base = {
	status: "failed" as const,
	flowName: "build",
	project,
	owner: true,
};

describe("askWhy", () => {
	test("a failed, stopped or interrupted run of a flow here is ready", () => {
		for (const status of ["failed", "stopped", "interrupted"] as const) {
			expect(askWhy({ ...base, status })).toEqual({
				kind: "ready",
				projectId: "p1",
				flowName: "build",
			});
		}
	});

	test("a run that goes on or finished has nothing to explain", () => {
		for (const status of [
			"running",
			"waiting",
			"sleeping",
			"finished",
		] as const) {
			expect(askWhy({ ...base, status }).kind).toBe("hidden");
		}
	});

	test("hidden without a flow file, or for a project of another Space", () => {
		expect(askWhy({ ...base, flowName: null }).kind).toBe("hidden");
		expect(askWhy({ ...base, project: undefined }).kind).toBe("hidden");
	});

	test("a member who does not own this computer sees why it is off", () => {
		const result = askWhy({ ...base, owner: false });
		expect(result.kind).toBe("disabled");
	});

	test("a project without a copy on this computer says so", () => {
		const result = askWhy({
			...base,
			project: { id: "p1", repoPath: null },
		});
		expect(result).toEqual({
			kind: "disabled",
			reason:
				"This project is not on this computer. Open the run on a computer that has it.",
		});
	});

	test("waits for the owner check before it offers the action", () => {
		expect(askWhy({ ...base, owner: undefined }).kind).toBe("hidden");
	});
});

describe("askWhyAnswer", () => {
	test("the phone asks for one answer about every run that ended early, and nothing else", () => {
		for (const status of ["failed", "stopped", "interrupted"] as const) {
			expect(askWhyAnswer(status)).toBe(true);
		}
		for (const status of [
			"running",
			"waiting",
			"sleeping",
			"finished",
		] as const) {
			expect(askWhyAnswer(status)).toBe(false);
		}
	});
});
