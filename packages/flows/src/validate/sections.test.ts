import { describe, expect, test } from "bun:test";
import { type Flow, type FlowSection, flowSchema } from "../document";
import { parseFlow, validateFlow } from "./flow";

const command = (id: string) => ({
	id,
	type: "command" as const,
	position: { x: 0, y: 0 },
	command: "true",
});

/** a → b → c → d, and a fails to e. */
const flowWith = (sections: FlowSection[]): Flow =>
	flowSchema.parse({
		version: 7,
		start: "a",
		nodes: ["a", "b", "c", "d", "e"].map(command),
		edges: [
			{ id: "ab", from: "a", outcome: "pass", to: "b" },
			{ id: "bc", from: "b", outcome: "pass", to: "c" },
			{ id: "cd", from: "c", outcome: "pass", to: "d" },
			{ id: "ae", from: "a", outcome: "fail", to: "e" },
		],
		sections,
	});

/** The issues about Sections only. */
const sectionIssues = (flow: Flow) =>
	validateFlow(flow).filter((issue) => issue.sectionId !== undefined);

describe("the checks of Sections", () => {
	test("good Sections give no issues", () => {
		const flow = flowWith([
			{ id: "start", label: "Start", color: "blue", nodes: ["a"] },
			{ id: "work", label: "Work", nodes: ["b", "c", "d"] },
		]);
		expect(sectionIssues(flow)).toEqual([]);
		// The same issues as the flow without them.
		expect(validateFlow(flow)).toEqual(validateFlow(flowWith([])));
	});

	test("every issue is a warning: a flow with bad Sections still runs", () => {
		const flow = flowWith([
			{ id: "x", label: "X", nodes: ["b", "e", "zz"] },
			{ id: "x", label: "Y", nodes: ["b"] },
		]);
		const issues = sectionIssues(flow);
		expect(issues.length).toBeGreaterThan(0);
		expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
	});

	test("ids used twice", () => {
		expect(
			sectionIssues(
				flowWith([
					{ id: "work", label: "Work", nodes: ["b"] },
					{ id: "work", label: "More work", nodes: ["c"] },
				]),
			),
		).toContainEqual({
			severity: "warning",
			message: 'Two Sections use the id "work". Give each Section its own id.',
			sectionId: "work",
		});
	});

	test("unknown nodes", () => {
		expect(
			sectionIssues(
				flowWith([{ id: "work", label: "Work", nodes: ["b", "zz"] }]),
			),
		).toEqual([
			{
				severity: "warning",
				message:
					'Section "Work" holds "zz", but this flow has no node "zz". Remove it from the Section.',
				sectionId: "work",
			},
		]);
	});

	test("a node in two Sections is reported once, on the later Section", () => {
		expect(
			sectionIssues(
				flowWith([
					{ id: "one", label: "One", nodes: ["b", "c"] },
					{ id: "two", label: "Two", nodes: ["c", "d"] },
				]),
			),
		).toContainEqual({
			severity: "warning",
			message:
				'Node "c" is in Section "One" and in Section "Two". Put each node in one Section only.',
			sectionId: "two",
			nodeId: "c",
		});
	});

	test("a Section that falls apart, with two entries", () => {
		expect(
			sectionIssues(
				flowWith([{ id: "mixed", label: "Mixed", nodes: ["b", "e"] }]),
			),
		).toEqual([
			{
				severity: "warning",
				message:
					'The nodes in Section "Mixed" are not all connected. Connect them, or take nodes out of the Section.',
				sectionId: "mixed",
			},
			{
				severity: "warning",
				message:
					'The flow comes into Section "Mixed" at "b" and "e". Send the edges from outside to one node only.',
				sectionId: "mixed",
			},
		]);
	});

	test("a Section no edge leads into", () => {
		const flow = flowWith([{ id: "lost", label: "", nodes: ["d"] }]);
		const unreachable = {
			...flow,
			edges: flow.edges.filter((edge) => edge.id !== "cd"),
		};
		expect(sectionIssues(unreachable)).toEqual([
			{
				severity: "warning",
				message:
					'No edge leads into Section "lost". Connect a node outside the Section to one of its nodes.',
				sectionId: "lost",
			},
		]);
	});

	test("a Section with no nodes", () => {
		expect(
			sectionIssues(flowWith([{ id: "e", label: "Empty", nodes: [] }])),
		).toEqual([
			{
				severity: "warning",
				message: 'Section "Empty" has no nodes. Add nodes to it, or remove it.',
				sectionId: "e",
			},
		]);
	});
});

const withoutSections = ({ sections: _, ...rest }: Record<string, unknown>) =>
	rest;

describe("Sections in the file", () => {
	test("parseFlow keeps them; a flow without them has no field", () => {
		const sections: FlowSection[] = [
			{
				id: "work",
				label: "Work",
				color: "teal",
				description: "Builds and checks.",
				nodes: ["b", "c", "d"],
			},
		];
		const json = JSON.parse(JSON.stringify(flowWith(sections)));
		expect(parseFlow(json).flow?.sections).toEqual(sections);
		expect("sections" in (parseFlow(withoutSections(json)).flow ?? {})).toBe(
			false,
		);
	});

	test("a colour is one of the names, not a value", () => {
		const json = JSON.parse(JSON.stringify(flowWith([])));
		const result = parseFlow({
			...json,
			sections: [{ id: "x", label: "X", color: "#ff0000", nodes: ["a"] }],
		});
		expect(result.flow).toBeNull();
		expect(result.issues[0]?.message).toStartWith("sections.0.color:");
	});
});

describe("Sections inside Sections", () => {
	test("a valid nesting has no issues", () => {
		const flow = flowWith([
			{ id: "inner", label: "Inner", nodes: ["c", "d"] },
			{ id: "outer", label: "Outer", nodes: ["b"], sections: ["inner"] },
		]);
		expect(sectionIssues(flow)).toEqual([]);
	});

	test("warns on an unknown Section, one held twice, and one inside itself", () => {
		const messages = sectionIssues(
			flowWith([
				{ id: "inner", label: "Inner", nodes: ["c"] },
				{ id: "x", label: "X", nodes: ["b"], sections: ["inner", "nope"] },
				{ id: "y", label: "Y", nodes: ["d"], sections: ["inner", "y"] },
			]),
		).map((issue) => issue.message);
		expect(messages).toContain(
			'Section "X" holds the Section "nope", but this flow has no Section "nope". Remove it from Section "X".',
		);
		expect(messages).toContain(
			'Section "inner" is in Section "X" and in Section "Y". Put each Section in one Section only.',
		);
		expect(messages).toContain(
			'Section "Y" holds itself, or a Section around it. Remove "y" from it.',
		);
	});
});
