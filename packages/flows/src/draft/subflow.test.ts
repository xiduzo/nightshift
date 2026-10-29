import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Flow, type FlowInput, flowSchema } from "../flow";
import { validateFlow } from "../validate";
import {
	planSubflowFromSection,
	type SubflowChange,
	type SubflowOptions,
	type SubflowPlan,
} from "./subflow";

/**
 * The fixture has the shape of a real build flow (ids, types, outcomes,
 * edges, positions) with neutral prompts: Intake, Spec, Build, Review and
 * Ship Sections, variables the reviewers append to, and loops back.
 */
const factory: Flow = flowSchema.parse(
	JSON.parse(
		readFileSync(join(import.meta.dir, "fixtures", "factory.json"), "utf8"),
	),
);

const options = (name: string): SubflowOptions => ({
	name,
	existingFlowNames: ["factory"],
	flows: {},
	flowName: "factory",
});

function planned(plan: SubflowPlan) {
	if (!plan.ok) throw new Error(JSON.stringify(plan.blockers));
	return plan;
}

const codes = (changes: SubflowChange[]) => changes.map((c) => c.code);
const change = <C extends SubflowChange["code"]>(
	changes: SubflowChange[],
	code: C,
) =>
	changes.filter((c) => c.code === code) as Extract<
		SubflowChange,
		{ code: C }
	>[];

/** The errors of both files, checked together as the project would. */
function errorsOf(plan: Extract<SubflowPlan, { ok: true }>, name: string) {
	const flows = { [name]: plan.subflow };
	return [
		...validateFlow(plan.subflow, { flows, name }),
		...validateFlow(plan.caller, { flows, name: "factory" }),
	].filter((issue) => issue.severity === "error");
}

const nodeOf = (flow: Flow, id: string) => {
	const node = flow.nodes.find((n) => n.id === id);
	if (!node) throw new Error(`no node ${id}`);
	return node;
};

const command = (id: string, cmd = "true", extra: object = {}) => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command: cmd,
	...extra,
});
const flowOf = (input: Omit<FlowInput, "version">): Flow =>
	flowSchema.parse({ version: 7, ...input });

describe("planSubflowFromSection on the build flow", () => {
	test("Build: three exits through a Decision, the variables written back, outputs for the nodes outside", () => {
		const plan = planned(
			planSubflowFromSection(factory, "build", options("build-part")),
		);
		const { subflow, caller } = plan;
		expect(errorsOf(plan, "build-part")).toEqual([]);
		expect(plan.callNode).toBe("build_part");
		expect(plan.decisionNode).toBe("build_part_ended");

		// The new flow: the Section's nodes from its entry, an end node per exit.
		expect(subflow.start).toBe("build");
		expect(subflow.nodes.map((n) => n.id)).toEqual([
			"build",
			"stack",
			"scope",
			"end_blocked",
			"end_frontend",
			"end_backend",
		]);
		expect(nodeOf(subflow, "end_blocked")).toMatchObject({
			type: "decision",
			by: "rule",
			options: [{ name: "blocked" }],
		});
		expect(subflow.edges.map((e) => [e.from, e.outcome, e.to, e.max])).toEqual([
			["build", "built", "stack", undefined],
			["build", "blocked", "end_blocked", undefined],
			["stack", "ordered", "scope", undefined],
			["stack", "mixed", "build", 2],
			["scope", "frontend", "end_frontend", undefined],
			["scope", "backend", "end_backend", undefined],
		]);
		expect(subflow.inputs.map((i) => [i.name, i.type])).toEqual([
			["spec_data", "json"],
			["human_note", "text"],
			["findings_in", "json"],
			["approved_in", "json"],
			["round_in", "json"],
			["spec_commit_in", "text"],
		]);
		expect(subflow.variables).toEqual([
			{ name: "findings", type: "json", initial: "{{findings_in}}" },
			{ name: "approved", type: "boolean", initial: "{{approved_in}}" },
			{ name: "round", type: "number", initial: "{{round_in}}" },
			{ name: "spec_commit", type: "text", initial: "{{spec_commit_in}}" },
		]);
		expect(subflow.outputs).toEqual([
			{ name: "stack_data", value: "{{stack.data}}" },
			{ name: "build_data", value: "{{build.data}}" },
			{ name: "build_summary", value: "{{build.summary}}" },
			{ name: "findings", value: "{{vars.findings}}" },
			{ name: "approved", value: "{{vars.approved}}" },
			{ name: "round", value: "{{vars.round}}" },
		]);
		// Templates inside read the inputs; variables keep their names.
		expect(nodeOf(subflow, "build")).toMatchObject({
			prompt:
				"Build {{spec_data.name}} on {{vars.spec_commit}}. Fix: {{vars.findings}}. Note: {{human_note}}. Last check: {{stack.log_tail}}",
		});
		// Positions start at the Section's corner.
		expect(nodeOf(subflow, "build").position).toEqual({ x: 0, y: 0 });
		// End nodes stand in their own column, so none covers a node.
		const ends = subflow.nodes.filter((n) => n.id.startsWith("end_"));
		const innerRight = Math.max(
			...subflow.nodes
				.filter((n) => !n.id.startsWith("end_"))
				.map((n) => n.position.x),
		);
		expect(ends.length).toBeGreaterThan(0);
		for (const end of ends) {
			expect(end.position.x).toBeGreaterThan(innerRight);
		}
		const endYs = ends.map((n) => n.position.y);
		expect(new Set(endYs).size).toBe(endYs.length);

		// The caller: the Call where the Section was, its bindings and writes.
		expect(nodeOf(caller, "build_part")).toEqual({
			id: "build_part",
			type: "call",
			label: "Build",
			position: { x: 0, y: 848 },
			flow: "build-part",
			inputs: {
				spec_data: "{{spec.data}}",
				human_note: "{{human.note}}",
				findings_in: "{{vars.findings}}",
				approved_in: "{{vars.approved}}",
				round_in: "{{vars.round}}",
				spec_commit_in: "{{vars.spec_commit}}",
			},
			set: [
				{ variable: "findings", value: "{{build_part.findings}}" },
				{ variable: "approved", value: "{{build_part.approved}}" },
				{ variable: "round", value: "{{build_part.round}}" },
			],
		});
		expect(nodeOf(caller, "build_part_ended")).toMatchObject({
			type: "decision",
			by: "rule",
			options: [
				{ name: "blocked", when: 'build_part.ended = "blocked"' },
				{ name: "frontend", when: 'build_part.ended = "frontend"' },
				{ name: "backend" },
			],
		});
		for (const id of ["build", "stack", "scope"])
			expect(caller.nodes.some((n) => n.id === id)).toBe(false);
		// Edges in keep their ids and max; edges out leave the Decision.
		const edge = (id: string) => caller.edges.find((e) => e.id === id);
		expect(edge("validate-valid-build")?.to).toBe("build_part");
		expect(edge("verdict-changes-build")).toMatchObject({
			to: "build_part",
			max: 2,
		});
		expect(edge("human-revise-build")).toMatchObject({
			to: "build_part",
			max: 3,
		});
		expect(edge("build_part-pass-build_part_ended")).toMatchObject({
			from: "build_part",
			outcome: "pass",
			to: "build_part_ended",
		});
		expect(edge("scope-backend-security")).toMatchObject({
			from: "build_part_ended",
			outcome: "backend",
			to: "security",
		});
		expect(caller.edges.some((e) => e.id === "stack-mixed-build")).toBe(false);
		// Templates outside read the Call's outputs.
		expect(nodeOf(caller, "publish")).toMatchObject({
			command: 'publish "{{build_part.build_data.layers}}"',
		});
		expect(nodeOf(caller, "ux")).toMatchObject({
			prompt: "Review the change. Layers: {{build_part.stack_data.layers}}",
		});
		expect(caller.sections?.map((s) => s.id)).toEqual([
			"intake",
			"spec",
			"review",
			"ship",
		]);

		// The flow comes back into Build: what works differently is listed.
		expect(codes(plan.changes)).toEqual([
			"nodes-moved",
			"call-added",
			"input-added",
			"input-added",
			"input-added",
			"input-added",
			"input-added",
			"input-added",
			"output-added",
			"output-added",
			"output-added",
			"variable-written-back",
			"variable-written-back",
			"variable-written-back",
			"exit-added",
			"exit-added",
			"exit-added",
			"decision-added",
			"section-removed",
			"restarts-on-resume",
			"reads-earlier-pass",
			"loop-limit-per-call",
		]);
		expect(change(plan.changes, "reads-earlier-pass")[0]?.reads).toEqual([
			{ node: "build", reads: "stack" },
		]);
		expect(change(plan.changes, "loop-limit-per-call")[0]?.edges).toEqual([
			"stack-mixed-build",
		]);
		expect(change(plan.changes, "input-added")[5]).toEqual({
			kind: "info",
			code: "input-added",
			input: "spec_commit_in",
			type: "text",
			source: { kind: "variable", variable: "spec_commit" },
			readBy: ["build", "stack"],
		});
		expect(change(plan.changes, "output-added")[1]?.readBy).toEqual([
			{ node: "approver" },
			{ node: "publish" },
		]);
		expect(change(plan.changes, "exit-added")[0]).toEqual({
			kind: "info",
			code: "exit-added",
			label: "blocked",
			from: "build",
			outcome: "blocked",
			to: ["human"],
			endNode: "end_blocked",
		});
	});

	test("Spec: the ends inside become options of the Decision without an edge", () => {
		const plan = planned(
			planSubflowFromSection(factory, "spec", options("spec-part")),
		);
		expect(errorsOf(plan, "spec-part")).toEqual([]);
		expect(nodeOf(plan.caller, "spec_part_ended")).toMatchObject({
			options: [
				{ name: "valid", when: 'spec_part.ended = "valid"' },
				{ name: "out-of-scope", when: 'spec_part.ended = "out-of-scope"' },
				{ name: "stop" },
			],
		});
		expect(
			plan.caller.edges.filter((e) => e.from === "spec_part_ended"),
		).toEqual([
			{
				id: "validate-valid-build",
				from: "spec_part_ended",
				outcome: "valid",
				to: "build",
			},
		]);
		expect(change(plan.changes, "ends-inside")[0]?.ends).toEqual([
			{ node: "spec", outcome: "out-of-scope", option: "out-of-scope" },
			{ node: "clarify", outcome: "stop", option: "stop" },
		]);
		// The caller's inputs keep their names; spec_commit goes back.
		expect(plan.subflow.inputs.map((i) => i.name)).toEqual([
			"branch_data",
			"notes",
			"design_data",
			"spec_commit_in",
		]);
		expect(nodeOf(plan.caller, "spec_part")).toMatchObject({
			inputs: { notes: "{{notes}}", branch_data: "{{branch.data}}" },
			set: [{ variable: "spec_commit", value: "{{spec_part.spec_commit}}" }],
		});
		// Its loops stay inside, and the flow does not come back into it.
		expect(plan.subflow.edges.filter((e) => e.max !== undefined)).toHaveLength(
			2,
		);
		expect(plan.changes.filter((c) => c.kind === "differs")).toEqual([
			{ kind: "differs", code: "restarts-on-resume" },
		]);
	});

	test("Intake: the flow starts at the Call, and the flow's outputs read it", () => {
		const plan = planned(
			planSubflowFromSection(factory, "intake", options("intake")),
		);
		expect(errorsOf(plan, "intake")).toEqual([]);
		expect(plan.caller.start).toBe("intake");
		expect(plan.caller.outputs[0]).toEqual({
			name: "issue",
			value: "{{intake.branch_data.key}}",
		});
		expect(change(plan.changes, "start-moved")).toEqual([
			{ kind: "info", code: "start-moved", from: "branch", to: "intake" },
		]);
		// `rest` ends the run: the Decision ends the caller on `pass`.
		expect(change(plan.changes, "ends-inside")[0]?.ends).toEqual([
			{ node: "rest", outcome: "pass", option: "pass" },
		]);
		expect(plan.caller.edges.filter((e) => e.from === "intake_ended")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ outcome: "failed", to: "spec" }),
			]),
		);
	});

	test("Review: the flow enters it at two nodes, so it cannot be a Subflow", () => {
		expect(
			planSubflowFromSection(factory, "review", options("review")),
		).toEqual({
			ok: false,
			blockers: [
				{
					code: "section-not-valid",
					problems: [{ code: "several-entries", entries: ["ux", "security"] }],
				},
			],
		});
		expect(planSubflowFromSection(factory, "ship", options("ship"))).toEqual({
			ok: false,
			blockers: [
				{
					code: "section-not-valid",
					problems: [
						{
							code: "several-entries",
							entries: ["approver", "publish", "human"],
						},
					],
				},
			],
		});
	});

	test("Review from one entry: findings go back, verdict routes through the Decision, its loop limit stays", () => {
		const flow: Flow = {
			...factory,
			sections: [
				{
					id: "review",
					label: "Review",
					nodes: ["security", "code", "verdict"],
				},
			],
		};
		const plan = planned(
			planSubflowFromSection(flow, "review", options("review")),
		);
		expect(errorsOf(plan, "review")).toEqual([]);
		expect(nodeOf(plan.caller, "review")).toMatchObject({
			set: [{ variable: "findings", value: "{{review.findings}}" }],
		});
		expect(nodeOf(plan.caller, "review_ended")).toMatchObject({
			options: [
				{ name: "changes", when: 'review.ended = "changes"' },
				{ name: "pass" },
			],
		});
		// Both `changes` edges keep their order and max on the Decision.
		expect(plan.caller.edges.filter((e) => e.from === "review_ended")).toEqual([
			{
				id: "verdict-changes-build",
				from: "review_ended",
				outcome: "changes",
				to: "build",
				max: 2,
			},
			{
				id: "verdict-changes-publish",
				from: "review_ended",
				outcome: "changes",
				to: "publish",
			},
			{
				id: "verdict-pass-approver",
				from: "review_ended",
				outcome: "pass",
				to: "approver",
			},
		]);
		// The approver reads the reviewers through the Call.
		expect(nodeOf(plan.caller, "approver")).toMatchObject({
			prompt: expect.stringContaining(
				"{{review.security_summary}} {{review.code_summary}}",
			),
		});
		expect(plan.changes.filter((c) => c.kind === "differs")).toEqual([
			{ kind: "differs", code: "restarts-on-resume" },
		]);
	});
});

describe("planSubflowFromSection, small flows", () => {
	/** a → b → c → d, with b and c in a Section. */
	const chain = (extra: Partial<Omit<FlowInput, "version">> = {}) =>
		flowOf({
			start: "a",
			nodes: [command("a"), command("b"), command("c"), command("d")],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "cd", from: "c", outcome: "pass", to: "d" },
			],
			sections: [{ id: "middle", label: "Middle", nodes: ["b", "c"] }],
			...extra,
		});
	const plain = { name: "middle", existingFlowNames: [] };

	test("one exit on a chosen end: the Call goes on straight, with no end node and no Decision", () => {
		const plan = planned(planSubflowFromSection(chain(), "middle", plain));
		expect(plan.decisionNode).toBeNull();
		expect(plan.subflow.nodes.map((n) => n.id)).toEqual(["b", "c"]);
		expect(plan.subflow.edges.map((e) => e.id)).toEqual(["bc"]);
		expect(plan.caller.edges).toEqual([
			{ id: "ab", from: "a", outcome: "pass", to: "middle" },
			{ id: "cd", from: "middle", outcome: "pass", to: "d" },
		]);
		expect(plan.caller.sections).toBeUndefined();
		expect(change(plan.changes, "exit-added")[0]?.endNode).toBeNull();
	});

	test("a Section inside a Section: the Call takes its place in the outer one, the inner Sections go along", () => {
		const nested = flowOf({
			start: "a",
			nodes: ["a", "b", "c", "d", "e"].map((id) => command(id)),
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "cd", from: "c", outcome: "pass", to: "d" },
				{ id: "de", from: "d", outcome: "pass", to: "e" },
			],
			sections: [
				{ id: "outer", label: "Outer", nodes: ["b"], sections: ["middle"] },
				{ id: "middle", label: "Middle", nodes: ["c"], sections: ["last"] },
				{ id: "last", label: "Last", nodes: ["d"] },
			],
		});
		const plan = planned(planSubflowFromSection(nested, "middle", plain));
		expect(plan.subflow.nodes.map((n) => n.id)).toEqual(["c", "d"]);
		expect(plan.subflow.sections).toEqual([
			{ id: "last", label: "Last", nodes: ["d"] },
		]);
		expect(plan.caller.sections).toEqual([
			{ id: "outer", label: "Outer", nodes: ["b", "middle"] },
		]);
	});

	test("one exit on a failure: an end node turns it into an end the Call passes on", () => {
		// c has one exit, a catch-all: it never ends the flow as chosen.
		const flow = chain({
			nodes: [
				command("a"),
				command("b"),
				command("c", "false", { exits: [{ name: "fail" }] }),
				command("d"),
			],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "cd", from: "c", outcome: "fail", to: "d" },
			],
		});
		const plan = planned(planSubflowFromSection(flow, "middle", plain));
		expect(plan.decisionNode).toBeNull();
		expect(plan.subflow.edges.at(-1)).toEqual({
			id: "c-fail-end_fail",
			from: "c",
			outcome: "fail",
			to: "end_fail",
		});
		expect(plan.caller.edges.at(-1)).toEqual({
			id: "cd",
			from: "middle",
			outcome: "pass",
			to: "d",
		});
	});

	test("exits on the same outcome get the node in their label", () => {
		const flow = flowOf({
			start: "a",
			nodes: [
				command("a"),
				command("b"),
				command("c"),
				command("x"),
				command("y"),
			],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "bx", from: "b", outcome: "fail", to: "x" },
				{ id: "cy", from: "c", outcome: "fail", to: "y" },
			],
			sections: [{ id: "s", label: "S", nodes: ["b", "c"] }],
		});
		const plan = planned(planSubflowFromSection(flow, "s", plain));
		expect(change(plan.changes, "exit-added").map((c) => c.label)).toEqual([
			"b-fail",
			"c-fail",
		]);
		// c ends on pass with no edge: the caller ends there too.
		expect(change(plan.changes, "decision-added")[0]?.options).toEqual([
			"b-fail",
			"c-fail",
			"pass",
		]);
		expect(
			validateFlow(plan.subflow).filter((i) => i.severity === "error"),
		).toEqual([]);
	});

	test("run fields that differ inside a Call become inputs", () => {
		const flow = chain({
			nodes: [
				command("a"),
				command("b", 'echo "{{run.flow}} {{run.branch}} {{run.index}}"'),
				command("c"),
				command("d"),
			],
		});
		const plan = planned(planSubflowFromSection(flow, "middle", plain));
		expect(nodeOf(plan.subflow, "b")).toMatchObject({
			command: 'echo "{{run_flow}} {{run.branch}} {{run_index}}"',
		});
		expect(nodeOf(plan.caller, "middle")).toMatchObject({
			inputs: { run_flow: "{{run.flow}}", run_index: "{{run.index}}" },
		});
	});

	test("a Section the flow comes back to: visits, sessions and reads of an earlier pass are listed", () => {
		const flow = flowOf({
			start: "a",
			nodes: [
				command("a"),
				command("b", 'echo "{{b.visit}}"'),
				{
					id: "c",
					type: "agent",
					position: { x: 0, y: 0 },
					prompt: "go",
					harness: "claude-code",
					model: "sonnet",
					permissionMode: "acceptEdits",
					session: "resume",
				},
				command("d", 'echo "{{c.summary}}"'),
				command("e"),
			],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "be", from: "b", outcome: "fail", to: "e" },
				{ id: "cd", from: "c", outcome: "pass", to: "d" },
				{ id: "ed", from: "e", outcome: "pass", to: "d" },
				{ id: "da", from: "d", outcome: "pass", to: "a", max: 3 },
			],
			sections: [{ id: "s", label: "S", nodes: ["b", "c"] }],
		});
		const plan = planned(planSubflowFromSection(flow, "s", plain));
		expect(plan.changes.filter((c) => c.kind === "differs")).toEqual([
			{ kind: "differs", code: "restarts-on-resume" },
			// After b fails, d reads c of an earlier pass.
			{
				kind: "differs",
				code: "reads-earlier-pass",
				reads: [
					{ node: "b", reads: "b" },
					{ node: "d", reads: "c" },
				],
			},
			{
				kind: "differs",
				code: "visit-per-call",
				reads: [{ node: "b", reads: "b" }],
			},
			{ kind: "differs", code: "session-per-call", nodes: ["c"] },
		]);
	});
});

describe("planSubflowFromSection blockers", () => {
	const flow = flowOf({
		start: "a",
		nodes: [command("a"), command("b"), command("c")],
		edges: [
			{ id: "ab", from: "a", outcome: "pass", to: "b" },
			{ id: "bc", from: "b", outcome: "pass", to: "c" },
		],
		sections: [{ id: "s", label: "S", nodes: ["b"] }],
	});

	test("an unknown Section", () => {
		expect(
			planSubflowFromSection(flow, "nope", {
				name: "x",
				existingFlowNames: [],
			}),
		).toEqual({
			ok: false,
			blockers: [{ code: "section-not-found", section: "nope" }],
		});
	});

	test("a name that is taken or not valid", () => {
		const blockers = (name: string) => {
			const plan = planSubflowFromSection(flow, "s", {
				name,
				existingFlowNames: ["taken"],
				flowName: "self",
			});
			return plan.ok ? [] : plan.blockers;
		};
		expect(blockers("taken")).toEqual([{ code: "name-taken", name: "taken" }]);
		expect(blockers("self")).toEqual([{ code: "name-taken", name: "self" }]);
		expect(blockers("Not Valid")).toEqual([
			{ code: "name-not-valid", name: "Not Valid" },
		]);
	});

	test("a flow with errors", () => {
		const broken = flowOf({
			...flow,
			nodes: [command("a", "echo {{nope.x}}"), command("b"), command("c")],
		});
		expect(
			planSubflowFromSection(broken, "s", { name: "x", existingFlowNames: [] }),
		).toEqual({ ok: false, blockers: [{ code: "flow-not-valid", errors: 1 }] });
	});

	test("rules that read across the frame", () => {
		const ruled = flowOf({
			start: "a",
			nodes: [
				command("a"),
				{
					id: "b",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "",
					by: "rule",
					options: [
						{ name: "yes", when: "a.exit_code = 0 and run.flow = 'x'" },
						{ name: "no" },
					],
				},
				{
					id: "c",
					type: "value",
					position: { x: 0, y: 0 },
					by: "rule",
					expression: "{ 'picked': b.outcome }",
					output: { type: "object" },
				},
			],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "yes", to: "c" },
				{ id: "bc2", from: "b", outcome: "no", to: "c" },
			],
			sections: [{ id: "s", label: "S", nodes: ["b"] }],
		});
		const plan = planSubflowFromSection(ruled, "s", {
			name: "x",
			existingFlowNames: [],
		});
		expect(plan).toEqual({
			ok: false,
			blockers: [
				{ code: "rule-reads-outside", node: "b", names: ["a", "run.flow"] },
				{ code: "rule-reads-inside", node: "c", names: ["b"] },
			],
		});
	});

	test("a Call inside that goes on after the stop time, or calls the new name", () => {
		const calls = flowOf({
			start: "a",
			nodes: [
				command("a"),
				{
					id: "b",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "x",
					inputs: {},
				},
				command("c"),
			],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "bs", from: "b", outcome: "stopped", to: "c" },
			],
			sections: [{ id: "s", label: "S", nodes: ["b"] }],
		});
		const plan = planSubflowFromSection(calls, "s", {
			name: "x",
			existingFlowNames: [],
		});
		expect(plan).toEqual({
			ok: false,
			blockers: [
				{ code: "stopped-edge", nodes: ["b"] },
				{ code: "calls-new-flow", nodes: ["b"] },
			],
		});
	});

	test("an edge inside after an edge outside with a max, on one outcome", () => {
		const mixed = flowOf({
			start: "a",
			nodes: [command("a"), command("b"), command("c"), command("d")],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c" },
				{ id: "cd", from: "c", outcome: "fail", to: "d", max: 1 },
				{ id: "cb", from: "c", outcome: "fail", to: "b", max: 2 },
			],
			sections: [{ id: "s", label: "S", nodes: ["b", "c"] }],
		});
		expect(
			planSubflowFromSection(mixed, "s", { name: "x", existingFlowNames: [] }),
		).toEqual({
			ok: false,
			blockers: [
				{ code: "mixed-exit", from: "c", outcome: "fail", edges: ["cd", "cb"] },
			],
		});
	});

	test("a loop through the Section whose only max is inside", () => {
		const looped = flowOf({
			start: "a",
			nodes: [command("a"), command("b"), command("c"), command("d")],
			edges: [
				{ id: "ab", from: "a", outcome: "pass", to: "b" },
				{ id: "bc", from: "b", outcome: "pass", to: "c", max: 2 },
				{ id: "cd", from: "c", outcome: "pass", to: "d" },
				{ id: "da", from: "d", outcome: "pass", to: "a" },
			],
			sections: [{ id: "s", label: "S", nodes: ["b", "c"] }],
		});
		expect(
			planSubflowFromSection(looped, "s", { name: "x", existingFlowNames: [] }),
		).toEqual({
			ok: false,
			blockers: [{ code: "loop-without-limit", edges: ["bc"] }],
		});
	});
});
