import { describe, expect, test } from "bun:test";
import { runReading } from "./run-reading";

type Detail = Parameters<typeof runReading>[0];
type Step = Detail["steps"][number];

const node = (id: string, flow?: string) =>
	flow ? { id, type: "call", flow } : { id, type: "command" };
const flow = (...nodes: ReturnType<typeof node>[]) =>
	({ nodes }) as unknown as Detail["flow"];

const step = (
	id: string,
	nodeId: string,
	parent: string | null = null,
	end: Partial<Pick<Step, "outcome" | "error">> = {},
) =>
	({
		id,
		nodeId,
		scope: parent ? { parentStepId: parent, itemId: null } : null,
		outcome: "pass",
		error: null,
		...end,
	}) as Step;

/** A run whose `build` Calls `feature`, which Calls `trace` once per item. */
const nested = (steps: Step[]): Detail => ({
	flow: flow(node("plan"), node("build", "feature")),
	calledFlows: {
		feature: flow(node("each_trace", "trace")),
		trace: flow(node("check")),
	},
	steps,
});

describe("runReading", () => {
	test("each step names the called flow it ran in, two levels down", () => {
		const { flowOf } = runReading(
			nested([
				step("s1", "plan"),
				step("s2", "build"),
				step("s3", "each_trace", "s2"),
				step("s4", "check", "s3"),
			]),
		);
		expect([...flowOf]).toEqual([
			["s1", null],
			["s2", null],
			["s3", "feature"],
			["s4", "trace"],
		]);
	});

	test("a Call whose own Call is not known names no flow below it", () => {
		// `s3` sits under a step the detail lacks: its node is not looked up
		// in the run's own flow, where a node of that id calls `feature`.
		const { flowOf } = runReading({
			...nested([step("s3", "build", "gone"), step("s4", "check", "s3")]),
		});
		expect(flowOf.get("s3")).toBeNull();
		expect(flowOf.get("s4")).toBeNull();
	});

	test("a loop of scopes ends", () => {
		const { flowOf } = runReading(
			nested([step("a", "build", "b"), step("b", "build", "a")]),
		);
		expect(flowOf.get("a")).toBeNull();
		expect(flowOf.get("b")).toBeNull();
	});

	test("the failed step is the last that ended badly, inside the flows it called", () => {
		const { failedStep } = runReading(
			nested([
				step("s1", "plan", null, { outcome: "fail" }),
				step("s2", "build", null, { outcome: "fail" }),
				step("s3", "each_trace", "s2", { outcome: "fail" }),
				step("s4", "check", "s3", { outcome: "error" }),
			]),
		);
		// Not the Subflow steps that failed because `s4` did.
		expect(failedStep?.id).toBe("s4");
	});

	test("an error counts, a custom outcome does not, and a good run has none", () => {
		const error = runReading(
			nested([
				step("s1", "plan", null, { outcome: "pass", error: "No such file." }),
				step("s2", "build", null, { outcome: "blocked" }),
			]),
		);
		expect(error.failedStep?.id).toBe("s1");
		for (const outcome of ["needs-input", "stopped", "interrupted"]) {
			const bad = runReading(nested([step("s1", "plan", null, { outcome })]));
			expect(bad.failedStep?.id).toBe("s1");
		}
		const running = runReading(
			nested([
				step("s1", "plan"),
				step("s2", "build", null, { outcome: null }),
			]),
		);
		expect(running.failedStep).toBeNull();
	});
});
