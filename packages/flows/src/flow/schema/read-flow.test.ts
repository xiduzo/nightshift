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

	test("a device or a profile by its name does not read, and says what to choose again", () => {
		const of = (node: object) =>
			readFlow({
				...json(),
				nodes: [{ id: "a", position: { x: 0, y: 0 }, ...node }],
			});
		const why = (node: object) => {
			const read = of(node);
			if (read.flow !== null) throw new Error("Expected no flow.");
			return [read.why, read.issues];
		};
		const device = "A device is named by its id. Choose the device again.";
		const profile =
			"A profile is named by its device and its id. Pick the profile again.";
		const tier =
			"Night Shift cannot read this tier. Check its fields, and pick its profile again.";
		const named = { device: { name: "LE2316" } };
		for (const node of [
			{ type: "command", command: "true" },
			{ type: "call", flow: "b" },
			{ type: "tool", connection: "c", tool: "t" },
		]) {
			expect(why({ ...node, ...named })).toEqual([
				"invalid",
				[{ path: "nodes.0.device", message: device }],
			]);
		}
		const agent = { type: "agent", prompt: "x" };
		expect(why({ ...agent, profile: "worker" })).toEqual([
			"invalid",
			[{ path: "nodes.0.profile", message: profile }],
		]);
		const model = {
			type: "decision",
			by: "model",
			prompt: "x",
			options: [{ name: "a" }, { name: "b" }],
		};
		for (const node of [agent, model]) {
			expect(why({ ...node, cascade: [{ profile: "worker" }] })).toEqual([
				"invalid",
				[{ path: "nodes.0.cascade.0", message: tier }],
			]);
		}
	});

	test("it changes nothing of what it reads", () => {
		for (const value of [json(), json(1), json(FLOW_VERSION + 1)]) {
			const before = JSON.stringify(value);
			readFlow(value);
			expect(JSON.stringify(value)).toBe(before);
		}
	});
});
