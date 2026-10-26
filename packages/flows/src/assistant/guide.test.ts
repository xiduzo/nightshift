import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Flow,
	type FlowNodeType,
	flowSchema,
	outputFieldsByType,
} from "../document";
import { reservedOutcomes } from "../nodes";
import { validateFlow } from "../validate";
import {
	fixLoopExample,
	flowAuthoringGuide,
	planEachExample,
	sampleNodes,
} from "./guide";

const guide = flowAuthoringGuide();

/** The flow `planEachExample` calls: it takes one task as `item`. */
const buildTask: Flow = flowSchema.parse({
	version: 6,
	inputs: [{ name: "item", type: "json", required: true }],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Do {{item.title}}: {{item.details}}",
		},
	],
	edges: [],
});

describe("the examples of the guide", () => {
	test("the fix loop is valid", () => {
		const issues = validateFlow(flowSchema.parse(fixLoopExample));
		expect(issues.filter((i) => i.severity === "error")).toEqual([]);
		// Only the outcome that ends the run on purpose.
		expect(issues.map((i) => i.nodeId)).toEqual(["approve"]);
	});

	test("plan and build each task is valid, with its called flow", () => {
		const flow = flowSchema.parse(planEachExample);
		const issues = validateFlow(flow, {
			flows: { "build-task": buildTask },
			name: "plan-and-build",
		});
		expect(issues.filter((i) => i.severity === "error")).toEqual([]);
		// Only the outcomes that end the run on purpose.
		expect(issues.map((i) => i.nodeId)).toEqual(["plan", "all_done"]);
	});

	test("each sample node is a valid node of its type", () => {
		for (const [type, node] of Object.entries(sampleNodes)) {
			const parsed = flowSchema.safeParse({
				version: 6,
				start: node.id,
				nodes: [node],
				edges: [],
			});
			expect(parsed.success, type).toBe(true);
		}
	});

	test("the guide shows the examples as they are", () => {
		expect(guide).toContain(JSON.stringify(fixLoopExample, null, 1));
		expect(guide).toContain(JSON.stringify(planEachExample, null, 1));
	});
});

describe("flowAuthoringGuide", () => {
	test("covers every node type with its output fields", () => {
		for (const type of Object.keys(outputFieldsByType) as FlowNodeType[]) {
			expect(guide).toContain(`### ${type}\n`);
			for (const field of outputFieldsByType[type]) {
				expect(guide).toContain(`\`${field}\``);
			}
		}
	});

	test("names the reserved outcomes and the template forms", () => {
		for (const outcome of reservedOutcomes) expect(guide).toContain(outcome);
		for (const form of ["{{task}}", "{{vars.", "{{run.", "{{check.log_tail}}"])
			expect(guide).toContain(form);
	});

	test("stays short enough for every prompt", () => {
		const words = guide.split(/\s+/).filter(Boolean).length;
		// 2700: the node review added End, Join, kits and profiles (Model
		// Profiles, the project's own), each with a few lines an author needs.
		expect(words).toBeLessThan(2700);
	});
});

/**
 * The `nightshift-flows` skill holds the guide after its marker. Rewrite it
 * with `UPDATE_SKILL=1 bun test src/assistant/guide.test.ts`.
 */
describe("the nightshift-flows skill", () => {
	const path = join(
		import.meta.dir,
		"..",
		"..",
		"..",
		"..",
		"skills",
		"nightshift-flows",
		"SKILL.md",
	);
	const marker =
		"<!-- Generated from flowAuthoringGuide() in packages/flows. Do not edit below this line. -->";

	test("holds the guide as it is", () => {
		const text = readFileSync(path, "utf8");
		const at = text.indexOf(marker);
		expect(at).toBeGreaterThan(0);
		const head = text.slice(0, at + marker.length);
		const want = `${head}\n\n${guide}`;
		if (process.env.UPDATE_SKILL === "1" && text !== want)
			writeFileSync(path, want);
		else expect(text).toBe(want);
	});
});
