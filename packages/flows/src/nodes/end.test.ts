import { describe, expect, test } from "bun:test";
import { addNode, planSubflowFromSection, renameNode } from "../draft";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { validateFlow } from "../validate";
import { endMessage, MAX_REPORT_BYTES, reportText } from "./end";

/** The End node: it ends the run on purpose, with a status and one line. */

function flow(extra: Partial<Flow> = {}): Flow {
	return flowSchema.parse({
		version: FLOW_VERSION,
		inputs: [{ name: "label", type: "text" }],
		start: "look",
		nodes: [
			{
				id: "look",
				type: "command",
				position: { x: 0, y: 0 },
				command: "gh issue list",
			},
			{
				id: "none",
				type: "end",
				position: { x: 300, y: 0 },
				status: "nothing-to-do",
				message: "No open issues for {{label}}",
			},
		],
		edges: [
			{ id: "look-pass-none", from: "look", outcome: "pass", to: "none" },
		],
		...extra,
	});
}

const messages = (f: Flow) => validateFlow(f).map((issue) => issue.message);

describe("the End node", () => {
	test("is valid with a status and a message that reads known names", () => {
		expect(messages(flow())).toEqual([]);
	});

	test("a message that reads an unknown name is an error", () => {
		const f = flow();
		const nodes = f.nodes.map((node) =>
			node.type === "end" ? { ...node, message: "{{ghost}}" } : node,
		);
		expect(messages({ ...f, nodes })).toContainEqual(
			expect.stringContaining('The message of "none" uses {{ghost}}'),
		);
	});

	test("no edge can leave it", () => {
		const f = flow();
		const issues = validateFlow({
			...f,
			edges: [
				...f.edges,
				{ id: "none-done-look", from: "none", outcome: "done", to: "look" },
			],
		});
		expect(issues).toContainEqual({
			severity: "error",
			message:
				'Edge "none-done-look" leaves the End node "none". An End node ends the run, so no edge can leave it.',
			edgeId: "none-done-look",
		});
	});

	test("takes only a known status", () => {
		expect(() =>
			flowSchema.parse({
				version: FLOW_VERSION,
				start: "x",
				nodes: [
					{ id: "x", type: "end", position: { x: 0, y: 0 }, status: "ok" },
				],
				edges: [],
			}),
		).toThrow();
	});

	test("the palette adds one that ends the run as done", () => {
		const { flow: next, id } = addNode(flow(), "end", { x: 0, y: 0 });
		expect(next.nodes.find((node) => node.id === id)).toEqual({
			id: "end",
			type: "end",
			position: { x: 0, y: 0 },
			status: "done",
			message: "",
		});
	});

	test("a Section with an End node does not become a Subflow", () => {
		const f = flow({
			sections: [{ id: "s", label: "Look", nodes: ["look", "none"] }],
		});
		const plan = planSubflowFromSection(f, "s", {
			name: "look",
			existingFlowNames: ["main"],
		});
		expect(plan.ok).toBe(false);
		if (!plan.ok) {
			expect(plan.blockers).toContainEqual({
				code: "end-node",
				nodes: ["none"],
			});
		}
	});
});

describe("the report of an End node", () => {
	const withReport = (text: string) => {
		const f = flow();
		return {
			...f,
			nodes: f.nodes.map((node) =>
				node.type === "end"
					? { ...node, report: { kind: "text" as const, text } }
					: node,
			),
		};
	};

	test("is a template of Markdown that reads known names", () => {
		const text = "## What is new\n\n{{look.log_tail}} for {{label}}";
		const f = flowSchema.parse(withReport(text));
		expect(messages(f)).toEqual([]);
		const end = f.nodes.find((node) => node.type === "end");
		expect(end?.type === "end" ? end.report : null).toEqual({
			kind: "text",
			text,
		});
	});

	test("a report that reads an unknown name is an error", () => {
		expect(messages(withReport("{{ghost}}"))).toContainEqual(
			expect.stringContaining('The report of "none" uses {{ghost}}'),
		);
	});

	test("follows a node that is renamed", () => {
		const renamed = renameNode(
			flowSchema.parse(withReport("Seen: {{look.log_tail}}")),
			"look",
			"scan",
		);
		const end = renamed.nodes.find((node) => node.type === "end");
		expect(end?.type === "end" ? end.report : null).toEqual({
			kind: "text",
			text: "Seen: {{scan.log_tail}}",
		});
		expect(messages(renamed)).toEqual([]);
	});

	test("takes only a known kind", () => {
		const f = flow();
		expect(() =>
			flowSchema.parse({
				...f,
				nodes: f.nodes.map((node) =>
					node.type === "end"
						? { ...node, report: { kind: "web", text: "x" } }
						: node,
				),
			}),
		).toThrow();
	});
});

describe("reportText", () => {
	test("keeps a short report, without blank lines on top and space at the end", () => {
		expect(reportText("\n  \n## News\n\n- one  \n\n")).toEqual({
			text: "## News\n\n- one",
			cut: false,
		});
	});

	test("is empty for a blank report", () => {
		expect(reportText(" \n\t\n")).toEqual({ text: "", cut: false });
	});

	test("keeps a report of exactly the cap", () => {
		const text = "a".repeat(MAX_REPORT_BYTES);
		expect(reportText(text)).toEqual({ text, cut: false });
	});

	test("cuts a longer report at the last line break within the cap", () => {
		const line = `${"a".repeat(99)}\n`;
		const rendered = line.repeat(1000);
		const { text, cut } = reportText(rendered);
		expect(cut).toBe(true);
		expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
			MAX_REPORT_BYTES,
		);
		// 655 whole lines fit in 65,536 bytes; the cut drops the line break.
		expect(text).toBe(line.repeat(655).trimEnd());
	});

	test("a line break right after the cap still keeps the last whole line", () => {
		const rendered = `${"a".repeat(MAX_REPORT_BYTES)}\nmore`;
		expect(reportText(rendered)).toEqual({
			text: "a".repeat(MAX_REPORT_BYTES),
			cut: true,
		});
	});

	test("cuts one long line before the character the cap falls in", () => {
		// "é" is 2 bytes and "😀" 4: the cap falls inside one of them.
		for (const char of ["é", "😀"]) {
			const rendered = `a${char.repeat(MAX_REPORT_BYTES)}`;
			const { text, cut } = reportText(rendered);
			const bytes = new TextEncoder().encode(text).length;
			expect(cut).toBe(true);
			expect(bytes).toBeLessThanOrEqual(MAX_REPORT_BYTES);
			expect(bytes).toBeGreaterThan(MAX_REPORT_BYTES - 4);
			expect(text).not.toContain("�");
			expect(text.startsWith(`a${char}`)).toBe(true);
		}
	});
});

describe("endMessage", () => {
	test("is the first line that is not blank, trimmed", () => {
		expect(endMessage("\n  No open issues  \nmore")).toBe("No open issues");
	});

	test("is null for a blank message", () => {
		expect(endMessage("  \n ")).toBeNull();
	});
});
