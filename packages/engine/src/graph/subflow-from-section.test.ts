import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Flow, planSubflowFromSection } from "@nightshift/flows";
import { deriveSteps } from "../read/derive-steps";
import { command, drive, edge, flowOf, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * "Make subflow from section" (`planSubflowFromSection` in flows) keeps
 * what a flow does: the engine runs the flow with the Section and the
 * caller with its Subflow to the same end, with the same variables and
 * the same values read after the Section.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

/**
 * prep → [a → b] → one | two, and two → a again (max 3). `a` counts and
 * collects in variables; `b` exits `other` until the count reaches 2.
 * The commands read an input, a node before the Section, a run field
 * that differs inside a Call, and the variables.
 */
const withSection: Flow = flowOf(
	[
		command("prep", "printf hello"),
		command("a", 'echo "{{prep.log_tail}} {{who}} {{run.flow}}"', {
			set: [
				{ variable: "count", expression: "vars.count + 1" },
				{ variable: "seen", expression: "$append(vars.seen, [vars.count])" },
			],
		}),
		command("b", '[ "{{vars.count}}" -ge 2 ] && exit 0 || exit 3', {
			exits: [
				{ name: "ok", code: 0 },
				{ name: "other", code: 3 },
				{ name: "failed" },
			],
		}),
		command("one", 'echo "one {{a.log_tail}} {{vars.count}} {{vars.seen}}"'),
		command("two", 'echo "two {{a.log_tail}} {{vars.count}}"'),
	],
	[
		edge("e1", "prep", "pass", "a"),
		edge("e2", "a", "pass", "b"),
		edge("e3", "b", "ok", "one"),
		edge("e4", "b", "other", "two"),
		{ ...edge("e5", "two", "pass", "a"), max: 3 },
	],
	{
		inputs: [{ name: "who", type: "text", default: "bob" }],
		variables: [
			{ name: "count", type: "number", initial: "0" },
			{ name: "seen", type: "json", initial: "[]" },
		],
		sections: [{ id: "work", label: "Work", nodes: ["a", "b"] }],
	},
);

/** How a run ended, the variables it left and what each node outside printed last. */
async function runOf(flow: Flow, flows: Record<string, Flow> = {}) {
	const h = await startRun(sandbox, flow, { flows });
	const { parked, state } = await drive(h, { inputs: { who: "bob" } });
	const steps = deriveSteps(await h.events()).filter((s) => s.scope === null);
	const printed = (id: string) =>
		steps.filter((s) => s.nodeId === id).at(-1)?.outputs.log_tail;
	return {
		parked,
		ended: state.ended,
		vars: state.vars,
		one: printed("one"),
		two: printed("two"),
		visitsOfTwo: steps.filter((s) => s.nodeId === "two").length,
	};
}

describe("a Section made into a Subflow", () => {
	test("runs to the same end, with the same variables and values", async () => {
		const plan = planSubflowFromSection(withSection, "work", {
			name: "work",
			existingFlowNames: [],
			flows: {},
		});
		if (!plan.ok) throw new Error(JSON.stringify(plan.blockers));
		expect(plan.decisionNode).toBe("work_ended");

		const before = await runOf(withSection);
		expect(before).toMatchObject({
			parked: [],
			ended: { status: "finished", nodeId: "one", outcome: "pass" },
			// Each write sees the ones before it.
			vars: { count: 2, seen: [1, 2] },
			// The caller's flow name, not the Subflow's.
			one: "one hello bob test 2 [1,2]",
			two: "two hello bob test 1",
			visitsOfTwo: 1,
		});
		expect(await runOf(plan.caller, { work: plan.subflow })).toEqual(before);
	});

	test("an end inside ends the caller at the Decision, on the same label", async () => {
		// b ends the flow on `ok` now: no edge leaves it there.
		const ends: Flow = {
			...withSection,
			nodes: withSection.nodes.map((node) =>
				node.id === "b"
					? {
							...node,
							type: "decision",
							prompt: "",
							by: "rule",
							decider: "typesafe",
							options: [
								{ name: "ok", when: "vars.count >= 2" },
								{ name: "other" },
							],
						}
					: node,
			) as Flow["nodes"],
			edges: withSection.edges.filter((e) => e.id !== "e3"),
		};
		const plan = planSubflowFromSection(ends, "work", {
			name: "work",
			existingFlowNames: [],
			flows: {},
		});
		if (!plan.ok) throw new Error(JSON.stringify(plan.blockers));

		const before = await runOf(ends);
		expect(before.ended).toMatchObject({
			status: "finished",
			nodeId: "b",
			outcome: "ok",
		});
		const after = await runOf(plan.caller, { work: plan.subflow });
		expect(after.ended).toMatchObject({
			status: "finished",
			nodeId: "work_ended",
			outcome: "ok",
		});
		expect({ ...after, ended: null }).toEqual({ ...before, ended: null });
	});
});
