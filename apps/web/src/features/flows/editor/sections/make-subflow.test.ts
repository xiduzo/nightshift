import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	type FlowNode,
	planSubflowFromSection,
} from "@nightshift/flows";
import {
	groupSubflowChanges,
	makeSubflow,
	plannedName,
	planSubflowDialog,
	projectFlowNames,
	type ReadySubflowPlan,
	subflowNameFor,
} from "./make-subflow";

/** a → b → c → d, with b and c in the Section "Middle part". */
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "a",
	// Without exits, a Command ends `pass` on 0 and `fail` on any other code.
	nodes: ["a", "b", "c", "d"].map(
		(id, index): FlowNode => ({
			id,
			type: "command",
			position: { x: index * 300, y: 0 },
			command: "true",
			output: "text",
		}),
	),
	edges: [
		{ id: "ab", from: "a", outcome: "pass", to: "b" },
		{ id: "bc", from: "b", outcome: "pass", to: "c" },
		{ id: "cd", from: "c", outcome: "pass", to: "d" },
	],
	sections: [{ id: "middle", label: "Middle part", nodes: ["b", "c"] }],
};

const project = { flows: { other: null }, flowName: "main" };

function ready(name = "middle-part"): ReadySubflowPlan {
	const plan = planSubflowFromSection(flow, "middle", {
		name,
		existingFlowNames: ["main"],
	});
	if (!plan.ok) throw new Error(JSON.stringify(plan.blockers));
	return plan;
}

describe("subflowNameFor", () => {
	test("makes a flow name of the label", () => {
		expect(subflowNameFor({ id: "s", label: "Code review" }, [])).toBe(
			"code-review",
		);
		expect(subflowNameFor({ id: "s", label: "  Spec & UX!  " }, [])).toBe(
			"spec-ux",
		);
	});

	test("takes the id, then a word, when the label gives nothing", () => {
		expect(subflowNameFor({ id: "build_steps", label: "" }, [])).toBe(
			"build-steps",
		);
		expect(subflowNameFor({ id: "__", label: "!!" }, [])).toBe("subflow");
	});

	test("adds a number until the project does not have the name", () => {
		expect(
			subflowNameFor({ id: "s", label: "Review" }, ["review", "review-2"]),
		).toBe("review-3");
	});

	test("stays at 60 characters", () => {
		const name = subflowNameFor({ id: "s", label: "x".repeat(80) }, [
			"x".repeat(60),
		]);
		expect(name).toBe(`${"x".repeat(58)}-2`);
	});
});

describe("projectFlowNames", () => {
	test("the other flows and this one, once each", () => {
		expect(projectFlowNames({ a: null, main: null }, "main")).toEqual([
			"a",
			"main",
		]);
	});
});

describe("planSubflowDialog", () => {
	test("a free, valid name gives a plan to confirm", () => {
		const plan = planSubflowDialog(flow, "middle", "middle-part", project);
		expect(plan.nameProblem).toBeNull();
		expect(plan.blockers).toEqual([]);
		expect(plan.ready).not.toBeNull();
		expect(plan.preview).toBe(plan.ready);
	});

	test("a taken name: the field says so, and the changes still show", () => {
		for (const name of ["other", "main"]) {
			const plan = planSubflowDialog(flow, "middle", name, project);
			expect(plan.nameProblem).toEqual({ code: "name-taken", name });
			expect(plan.ready).toBeNull();
			expect(plan.blockers).toEqual([]);
			expect(plan.preview?.changes.length).toBeGreaterThan(0);
		}
	});

	test("a name that is not valid, or empty, cannot be confirmed", () => {
		for (const name of ["", "Middle Part"]) {
			const plan = planSubflowDialog(flow, "middle", name, project);
			expect(plan.nameProblem?.code).toBe("name-not-valid");
			expect(plan.ready).toBeNull();
		}
	});

	test("a Section that cannot be a Subflow gives its blockers and no changes", () => {
		const twoWaysIn: Flow = {
			...flow,
			edges: [...flow.edges, { id: "ac", from: "a", outcome: "fail", to: "c" }],
		};
		for (const name of ["middle-part", "Not Valid"]) {
			const plan = planSubflowDialog(twoWaysIn, "middle", name, project);
			expect(plan.blockers.map((b) => b.code)).toEqual(["section-not-valid"]);
			expect(plan.preview).toBeNull();
			expect(plan.ready).toBeNull();
		}
	});

	test("an unknown Section", () => {
		const plan = planSubflowDialog(flow, "gone", "x", project);
		expect(plan.blockers).toEqual([
			{ code: "section-not-found", section: "gone" },
		]);
	});
});

describe("groupSubflowChanges", () => {
	test("every change lands in one group, differs first", () => {
		const { changes } = ready();
		const groups = groupSubflowChanges(changes);
		expect(Object.values(groups).flat()).toHaveLength(changes.length);
		expect(groups.differs.map((c) => c.code)).toEqual(["restarts-on-resume"]);
		expect(groups.moves.map((c) => c.code)).toEqual([
			"nodes-moved",
			"call-added",
			"section-removed",
		]);
		expect(groups.exits.map((c) => c.code)).toEqual(["exit-added"]);
	});
});

describe("makeSubflow", () => {
	test("writes the new flow, then gives the new draft", async () => {
		const plan = ready();
		const written: [string, Flow][] = [];
		const made = await makeSubflow(plan, async (name, file) => {
			written.push([name, file]);
		});
		expect(written).toEqual([["middle-part", plan.subflow]]);
		expect(made).toEqual({
			ok: true,
			name: "middle-part",
			caller: plan.caller,
			callNode: "middle_part",
		});
	});

	test("a failed write gives no new draft", async () => {
		const made = await makeSubflow(ready(), async () => {
			throw new Error("The project is read only.");
		});
		expect(made).toEqual({ ok: false, message: "The project is read only." });
	});

	test("the file name is the flow the Subflow runs", () => {
		expect(plannedName(ready("part-two"))).toBe("part-two");
	});
});
