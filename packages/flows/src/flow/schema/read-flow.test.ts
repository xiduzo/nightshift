import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "./flow";
import { readFlow } from "./read-flow";

const json = (version: unknown = FLOW_VERSION) => ({
	version,
	start: "a",
	nodes: [
		{
			id: "a",
			type: "command",
			position: { x: 0, y: 0 },
			command: "true",
		},
	],
	edges: [],
});

describe("readFlow", () => {
	test("the current format reads as the schema reads it, with its defaults", () => {
		expect(readFlow(json())).toEqual({ flow: flowSchema.parse(json()) });
	});

	test("an unknown field is left out, and an old one is no old flow", () => {
		const flow = json();
		expect(
			readFlow({
				...flow,
				nodes: [{ ...flow.nodes[0], tools: ["github"] }],
				later: true,
			}),
		).toEqual({ flow: flowSchema.parse(flow) });
	});

	test("every older version is older, whatever the flow holds", () => {
		for (const version of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8.5]) {
			for (const value of [json(version), { version }, { version, nodes: 1 }]) {
				expect(readFlow(value)).toEqual({
					flow: null,
					why: "older",
					issues: [
						{
							path: "",
							message: "An older version of Night Shift made this flow.",
						},
					],
				});
			}
		}
	});

	test("a later version is newer, whatever the flow holds", () => {
		for (const value of [
			json(FLOW_VERSION + 1),
			{ version: FLOW_VERSION + 0.5 },
		]) {
			expect(readFlow(value)).toEqual({
				flow: null,
				why: "newer",
				issues: [
					{
						path: "",
						message:
							"A newer version of Night Shift made this flow. Update Night Shift to use it.",
					},
				],
			});
		}
	});

	test("anything else is invalid, and never throws", () => {
		for (const value of [
			undefined,
			null,
			1,
			"9",
			[],
			{},
			json("9"),
			json(null),
			json(Number.NaN),
			{ ...json(), start: 1 },
		]) {
			const read = readFlow(value);
			if (read.flow !== null) throw new Error("Expected no flow.");
			expect(read.why).toBe("invalid");
			expect(read.issues.length).toBeGreaterThan(0);
		}
		expect(readFlow({ ...json(), nodes: [{ id: "a" }] })).toMatchObject({
			why: "invalid",
			issues: [{ path: "nodes.0.type" }],
		});
	});

	test("it changes nothing of what it reads", () => {
		for (const value of [json(), json(1), json(FLOW_VERSION + 1)]) {
			const before = JSON.stringify(value);
			readFlow(value);
			expect(JSON.stringify(value)).toBe(before);
		}
	});
});
