import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	FLOW_VERSION,
	type Flow,
	type FlowNodeType,
	flowSchema,
	NODE_FAMILY_LABEL,
	outputFieldsByType,
} from "../flow";
import { kitList } from "../kits";
import { reservedOutcomes } from "../nodes";
import { validateFlow } from "../validate";
import {
	findEachExample,
	fixLoopExample,
	flowAuthoringGuide,
	sampleNodes,
} from "./guide";

const guide = flowAuthoringGuide();

/** The flow `findEachExample` calls: it takes one source as `item`. */
const summarizeSource: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "item", type: "json", required: true }],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: {
				device: "8c1e4f2a-6b0d-4a7e-9f3c-2d5b7e9a1c4f",
				profile: "worker",
			},
			prompt: "Summarize {{item.title}}: {{item.url}}",
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

	test("find and summarize each source is valid, with its called flow", () => {
		const flow = flowSchema.parse(findEachExample);
		const issues = validateFlow(flow, {
			flows: { "summarize-source": summarizeSource },
			name: "find-and-summarize",
		});
		expect(issues.filter((i) => i.severity === "error")).toEqual([]);
		// Only the outcomes that end the run on purpose.
		expect(issues.map((i) => i.nodeId)).toEqual(["find", "all_read"]);
	});

	test("each sample node is a valid node of its type", () => {
		for (const [type, node] of Object.entries(sampleNodes)) {
			const parsed = flowSchema.safeParse({
				version: FLOW_VERSION,
				start: node.id,
				nodes: [node],
				edges: [],
			});
			expect(parsed.success, type).toBe(true);
		}
	});

	test("the guide shows the examples as they are", () => {
		expect(guide).toContain(JSON.stringify(fixLoopExample, null, 1));
		expect(guide).toContain(JSON.stringify(findEachExample, null, 1));
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

	test("lists every kit under the heading of its family", () => {
		const kits = guide.slice(
			guide.indexOf("## Kits\n"),
			guide.indexOf("## Profiles\n"),
		);
		for (const kit of kitList()) {
			const heading = kits.indexOf(`\n${NODE_FAMILY_LABEL[kit.family]}:\n`);
			const line = kits.indexOf(`- \`${kit.name}\` (`);
			expect(heading, kit.name).toBeGreaterThan(0);
			expect(line, kit.name).toBeGreaterThan(heading);
			// No other family heading between the two.
			const between = kits.slice(heading + 1, line);
			expect(between.match(/\n[A-Z][a-z]+:\n/g), kit.name).toBeNull();
		}
	});

	test("names the reserved outcomes and the template forms", () => {
		for (const outcome of reservedOutcomes) expect(guide).toContain(outcome);
		for (const form of ["{{task}}", "{{vars.", "{{run.", "{{check.log_tail}}"])
			expect(guide).toContain(form);
	});

	test("stays short enough for every prompt", () => {
		const words = guide.split(/\s+/).filter(Boolean).length;
		// 2900: the node review added End, Join and profiles (Model Profiles,
		// the project's own), each with a few lines an author needs, and the
		// list of kits, one line per kit (about 200 words). 2950: a profile
		// is a pair of ids (ADR 3), two more words per example node. 3150:
		// how to group a flow into Sections (about 190 words), so the
		// assistant tidies the flows it builds. 3200: the run budget and
		// the turn and idle limits of an Agent step. 3400: the knowledge
		// kits (one line each), the Agent's knowledge, $NS_KNOWLEDGE and
		// the review of learnings. 3450: the folder kit (one line) and the
		// number, boolean and choice inputs. 3600: the outcomes, rules and
		// `any` of a Wait (ADR 8), and the watch-pr kit (one line). 3700:
		// the Lease node (ADR 7). 3950: cascades (ADR 6), which replace the
		// loops of nodes that climbed from a cheap try to a strong one.
		// 4100: the Service node (ADR 9). 4350: the Ask (ADR 10), a Value
		// made by a person. 4450: a schedule's late window (`lateMinutes`)
		// and `{{run.due_at}}`, so a monthly run does not skip its day.
		// 4470: an Agent's knowledge as a list of folders. 4500: the
		// `scores` a Command writes (one sentence), so a flow can say what
		// it achieved. 4520: the \`title\` of a Gate and an Ask, the
		// heading in the inbox. 4680: the brief of a Gate (urgency,
		// situation, background, recommendation, impacts). 4720: format 9,
		// a Command's `stdout` and the `output` schema of a Command, a Tool
		// and a flow output. 4770: the Since last run node. 4840: the Convert
		// node, with its pairs and the fields of a feed item. 4920: the Web
		// request node and a Wait for a URL. 4995: the kits message/send,
		// feeds/read and email/send (a line each), and the secrets they read.
		// 5030: the report of an End node and a Subflow's `end_report`.
		// 5055: the `scores` of an Agent and a Value (one sentence each).
		// 5080: an End report from a file the run wrote. 5090: the kits
		// under their families, as the add-node dialog lists them.
		expect(words).toBeLessThan(5090);
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
