import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema } from "../document";
import {
	applySuggestion,
	outputChanges,
	promptOf,
	replaceRange,
	writeChanges,
} from "./apply";

const flow: Flow = flowSchema.parse({
	version: 7,
	start: "plan",
	inputs: [{ name: "ticket", type: "text" }],
	variables: [{ name: "tries", type: "number" }],
	nodes: [
		{
			id: "plan",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Plan the work.\nKeep it short.",
			output: {
				type: "object",
				properties: { title: { type: "string" } },
				required: ["title"],
			},
		},
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: "true",
		},
	],
	edges: [{ id: "e", from: "plan", outcome: "pass", to: "check" }],
});

const nodeOf = (next: Flow, id: string) =>
	next.nodes.find((node) => node.id === id);

describe("replaceRange", () => {
	test("replaces the range, or the whole text without one", () => {
		expect(replaceRange("abcdef", { start: 1, end: 3 }, "XY")).toBe("aXYdef");
		expect(replaceRange("abc", undefined, "new")).toBe("new");
	});

	test("cuts a range past the end, and reads a reversed range", () => {
		expect(replaceRange("abc", { start: 2, end: 99 }, "Z")).toBe("abZ");
		expect(replaceRange("abcdef", { start: 3, end: 1 }, "-")).toBe("a-def");
	});
});

describe("applySuggestion", () => {
	test("a prompt replaces the selection only", () => {
		const next = applySuggestion(
			flow,
			"plan",
			{ kind: "prompt", text: "Plan {{ticket}}.", note: "" },
			{ start: 0, end: "Plan the work.".length },
		);
		const plan = nodeOf(next, "plan");
		expect(plan && promptOf(plan)).toBe("Plan {{ticket}}.\nKeep it short.");
	});

	test("a prompt without a selection replaces the whole prompt", () => {
		const next = applySuggestion(flow, "plan", {
			kind: "prompt",
			text: "New.",
			note: "",
		});
		const plan = nodeOf(next, "plan");
		expect(plan && promptOf(plan)).toBe("New.");
	});

	test("a node without a prompt or an output keeps the flow as it is", () => {
		expect(
			applySuggestion(flow, "check", { kind: "prompt", text: "x", note: "" }),
		).toBe(flow);
		expect(
			applySuggestion(flow, "nope", { kind: "prompt", text: "x", note: "" }),
		).toBe(flow);
		const output = applySuggestion(flow, "check", {
			kind: "output",
			output: { type: "object" },
			note: "",
		});
		expect(nodeOf(output, "check")).toEqual(nodeOf(flow, "check"));
	});

	test("an output replaces the node's output schema", () => {
		const schema = {
			type: "object",
			properties: { url: { type: "string" } },
		};
		const next = applySuggestion(flow, "plan", {
			kind: "output",
			output: schema,
			note: "",
		});
		const plan = nodeOf(next, "plan");
		expect(plan?.type === "agent" ? plan.output : undefined).toEqual(schema);
	});

	test("set replaces the writes and declares only the missing variables", () => {
		const next = applySuggestion(flow, "plan", {
			kind: "set",
			set: [
				{ variable: "tries", expression: "vars.tries + 1" },
				{ variable: "title", value: "{{plan.data.title}}" },
			],
			variables: [
				{ name: "tries", type: "number" },
				{ name: "title", type: "text" },
				{ name: "title", type: "text" },
			],
			note: "",
		});
		expect(nodeOf(next, "plan")?.set).toHaveLength(2);
		expect(next.variables?.map((v) => v.name)).toEqual(["tries", "title"]);
	});

	test("set with no writes drops the node's set", () => {
		const withSet = applySuggestion(flow, "plan", {
			kind: "set",
			set: [{ variable: "tries", value: "1" }],
			variables: [],
			note: "",
		});
		const cleared = applySuggestion(withSet, "plan", {
			kind: "set",
			set: [],
			variables: [],
			note: "",
		});
		expect(nodeOf(cleared, "plan")).not.toHaveProperty("set");
	});
});

describe("outputChanges", () => {
	test("marks fields new, changed, the same and removed", () => {
		const before = {
			type: "object",
			properties: {
				title: { type: "string" },
				body: { type: "string" },
				gone: { type: "number" },
			},
			required: ["title"],
		};
		const after = {
			type: "object",
			properties: {
				title: { type: "string" },
				body: { type: "string", description: "The text." },
				tags: { type: "array", items: { type: "string" } },
			},
			required: ["title", "tags"],
		};
		expect(outputChanges(before, after)).toEqual([
			{ name: "title", type: "string", required: true, change: "same" },
			{
				name: "body",
				type: "string",
				description: "The text.",
				required: false,
				change: "changed",
			},
			{ name: "tags", type: "list of string", required: true, change: "new" },
			{ name: "gone", type: "number", required: false, change: "removed" },
		]);
	});

	test("every field is new without a schema before", () => {
		expect(
			outputChanges(undefined, {
				type: "object",
				properties: { ok: { type: "boolean" } },
			}).map((field) => field.change),
		).toEqual(["new"]);
	});
});

describe("writeChanges", () => {
	test("pairs writes by variable, in order", () => {
		const changes = writeChanges(
			[
				{ variable: "tries", expression: "vars.tries + 1" },
				{ variable: "title", value: "a" },
				{ variable: "old", value: "x" },
			],
			[
				{ variable: "tries", expression: "vars.tries + 1" },
				{ variable: "title", value: "b" },
				{ variable: "url", value: "{{plan.data.url}}" },
			],
		);
		expect(changes.map((row) => [row.write.variable, row.change])).toEqual([
			["tries", "same"],
			["title", "changed"],
			["url", "new"],
			["old", "removed"],
		]);
	});
});
