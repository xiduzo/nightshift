import { describe, expect, test } from "bun:test";
import {
	diffFlows,
	FLOW_VERSION,
	type Flow,
	flowSchema,
} from "@nightshift/flows";
import { diffLines, revisionAuthor } from "./revision-words";

const before: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "build",
	nodes: [
		{
			id: "build",
			type: "agent",
			label: "Build",
			position: { x: 0, y: 0 },
			prompt: "Build it.",
		},
		{
			id: "check",
			type: "command",
			position: { x: 300, y: 0 },
			command: "bun test",
			output: "text",
		},
	],
	edges: [{ id: "e1", from: "build", outcome: "pass", to: "check" }],
});

describe("the lines of a diff", () => {
	test("names each node, edge and input that was added, removed or changed", () => {
		const after: Flow = {
			...before,
			inputs: [{ name: "ticket", type: "text" }],
			nodes: [
				...before.nodes
					.filter((node) => node.id === "build")
					.map((node) =>
						node.type === "agent" ? { ...node, prompt: "Build more." } : node,
					),
				{
					id: "review",
					type: "command",
					position: { x: 300, y: 0 },
					command: "bun run lint",
					output: "text",
				},
			],
			edges: [{ id: "e2", from: "build", outcome: "pass", to: "review" }],
		};
		expect(diffLines(diffFlows(before, after), after)).toEqual([
			"Added node review",
			"Removed node check",
			"Changed node Build: prompt",
			"Added edge Build (pass) to review",
			"Removed edge Build (pass) to check",
			"Added input ticket",
		]);
	});

	test("names the nodes of an edge by their id without the flow it ends at", () => {
		const after: Flow = { ...before, edges: [] };
		expect(diffLines(diffFlows(before, after))).toEqual([
			"Removed edge build (pass) to check",
		]);
		expect(diffLines(diffFlows(before, after), after)).toEqual([
			"Removed edge Build (pass) to check",
		]);
	});

	test("counts nodes that only moved in one line", () => {
		const after: Flow = {
			...before,
			nodes: before.nodes.map((node) => ({
				...node,
				position: { x: node.position.x + 10, y: 0 },
			})),
		};
		expect(diffLines(diffFlows(before, after))).toEqual(["Moved 2 nodes"]);
	});
});

describe("the author of a revision", () => {
	test("is the person and the computer, or Night Shift when no person saved it", () => {
		const device = { id: "d1", name: "MacBook" };
		expect(revisionAuthor({ person: { id: "p1", name: "Ada" }, device })).toBe(
			"Ada on MacBook",
		);
		expect(
			revisionAuthor({ person: null, device: { id: "d2", name: null } }),
		).toBe("Night Shift on another computer");
	});
});
