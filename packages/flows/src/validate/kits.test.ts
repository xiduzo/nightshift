import { describe, expect, test } from "bun:test";
import { type FlowInput, flowSchema } from "../flow";
import { kitList } from "../kits";
import { parseFlow, validateFlow } from "./flow";

/** A flow that calls `flow` once with `inputs`, then ends and echoes `{{pr.url}}`. */
function caller(flow: string, inputs: Record<string, string>): FlowInput {
	return {
		version: 7,
		start: "pr",
		nodes: [
			{ id: "pr", type: "call", position: { x: 0, y: 0 }, flow, inputs },
			{
				id: "said",
				type: "command",
				position: { x: 300, y: 0 },
				command: 'echo "{{pr.url}}"',
			},
		],
		edges: [{ id: "pr-pass-said", from: "pr", outcome: "pass", to: "said" }],
	};
}

function errorsOf(flow: FlowInput, flows?: Record<string, null>): string[] {
	return validateFlow(flowSchema.parse(flow), { flows })
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);
}

describe("kits", () => {
	test("every kit is a flow without an error or a warning", () => {
		const kits = kitList();
		expect(kits.map((kit) => kit.name)).toEqual([
			"kit:github/create-branch",
			"kit:github/finish-pr",
			"kit:github/publish-draft-pr",
			"kit:github/wait-for-checks",
			"kit:jira/assign",
			"kit:jira/move",
			"kit:knowledge/confluence",
			"kit:knowledge/files",
			"kit:knowledge/github-wiki",
			"kit:knowledge/jira",
			"kit:knowledge/review-learnings",
			"kit:knowledge/web",
		]);
		for (const kit of kits) {
			expect({ kit: kit.name, issues: parseFlow(kit.flow).issues }).toEqual({
				kit: kit.name,
				issues: [],
			});
			expect(kit.flow.description).toBeDefined();
			for (const input of kit.flow.inputs) {
				expect(input.description).toBeDefined();
			}
			for (const output of kit.flow.outputs) {
				expect(output.description).toBeDefined();
			}
		}
	});

	test("a Call runs a kit by name, with or without the project's flows", () => {
		const flow = caller("kit:github/publish-draft-pr", { title: "Fix it" });
		expect(errorsOf(flow)).toEqual([]);
		expect(errorsOf(flow, { other: null })).toEqual([]);
	});

	test("a Call to a kit gets its inputs and outputs checked", () => {
		expect(errorsOf(caller("kit:github/publish-draft-pr", {}))).toEqual([
			'Subflow node "pr" does not bind the required input "title" of flow "kit:github/publish-draft-pr".',
		]);
		expect(
			errorsOf(
				caller("kit:github/publish-draft-pr", { title: "x", nope: "y" }),
			),
		).toEqual([
			'Subflow node "pr" binds the input "nope", but flow "kit:github/publish-draft-pr" has no such input.',
		]);
		expect(
			errorsOf(caller("kit:github/create-branch", { name: "x" }), {}),
		).toEqual([
			'The command of "said" uses {{pr.url}}, but "pr" has no field "url". Use one of: outcome, ended, end_message, visit, branch, created, sha.',
		]);
	});

	test("a kit that Night Shift does not have is an error", () => {
		expect(errorsOf(caller("kit:github/nope", {}), {})).toEqual([
			'Subflow node "pr" runs the kit "kit:github/nope", which Night Shift does not have. Pick a kit from the list.',
		]);
	});

	test("a kit name has a group and a name", () => {
		expect(parseFlow(caller("kit:nope", {})).flow).toBeNull();
		expect(parseFlow(caller("kit:github/Nope", {})).flow).toBeNull();
	});
});
