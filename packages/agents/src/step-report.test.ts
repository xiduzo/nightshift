import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RULES,
	parseStepReport,
	parseTextReport,
	REPORT_ACK,
	REPORT_TOOL_ID,
	REPORT_TOOL_NAME,
	type ReportRules,
	reportInputSchema,
	reportRules,
	reportStepTool,
	type StepReport,
	stepReportSetup,
	TEXT_REPORT_INSTRUCTION,
	TOOL_REPORT_INSTRUCTION,
	textReportInstruction,
	toolReportInstruction,
} from "./step-report";
import type { StepReportSpec } from "./types";

describe("stepReportSetup", () => {
	test("changes nothing without stepReport", () => {
		expect(
			stepReportSetup({ prompt: "Do it", permissionMode: "default" }, ["Read"]),
		).toEqual({ prompt: "Do it", allowedTools: ["Read"], withTool: false });
	});

	test.each(["default", "acceptEdits", "bypassPermissions"] as const)(
		"%s: the tool, allowed, with its instruction",
		(permissionMode) => {
			const setup = stepReportSetup(
				{ prompt: "Do it", permissionMode, stepReport: true },
				["Read", REPORT_TOOL_ID],
			);
			expect(setup).toEqual({
				prompt: `Do it\n\n${TOOL_REPORT_INSTRUCTION}`,
				allowedTools: ["Read", REPORT_TOOL_ID],
				withTool: true,
			});
		},
	);

	test("allows the tool when no allowedTools are set", () => {
		expect(
			stepReportSetup(
				{ prompt: "p", permissionMode: "default", stepReport: true },
				undefined,
			).allowedTools,
		).toEqual([REPORT_TOOL_ID]);
	});

	test("plan mode reports with text, without the tool", () => {
		expect(
			stepReportSetup(
				{ prompt: "Plan it", permissionMode: "plan", stepReport: true },
				["Read"],
			),
		).toEqual({
			prompt: `Plan it\n\n${TEXT_REPORT_INSTRUCTION}`,
			allowedTools: ["Read"],
			withTool: false,
		});
	});

	test("the tool id is the bridged MCP name", () => {
		expect(REPORT_TOOL_ID).toBe("mcp__tanstack__report_step");
	});
});

describe("parseStepReport", () => {
	test.each([
		[
			{ outcome: "pass", summary: "ok" },
			{ outcome: "pass", summary: "ok" },
		],
		[
			{ outcome: "needs-input", summary: " Which one? " },
			{ outcome: "needs-input", summary: "Which one?" },
		],
		[{ outcome: "PASS", summary: "ok" }, undefined],
		[{ outcome: "pass", summary: 3 }, undefined],
		[{ summary: "ok" }, undefined],
		[null, undefined],
		["pass", undefined],
	] as Array<[unknown, StepReport | undefined]>)("%p", (input, expected) => {
		expect(parseStepReport(input)).toEqual(expected);
	});
});

describe("parseTextReport", () => {
	test("reads the last marker line", () => {
		expect(
			parseTextReport(
				[
					'NIGHTSHIFT-REPORT: {"outcome": "fail", "summary": "first"}',
					"Then more work.",
					'  `NIGHTSHIFT-REPORT: {"outcome": "pass", "summary": "second"}`  ',
				].join("\n"),
			),
		).toEqual({ outcome: "pass", summary: "second" });
	});

	test.each([
		"No report here.",
		"NIGHTSHIFT-REPORT: not json",
		'NIGHTSHIFT-REPORT: {"outcome": "done", "summary": "x"}',
		'The marker NIGHTSHIFT-REPORT: {"outcome": "pass", "summary": "x"} mid-line',
	])("%s", (text) => {
		expect(parseTextReport(text)).toBeUndefined();
	});
});

describe("reportStepTool", () => {
	const tool = reportStepTool();

	test("is a server tool named report_step with a JSON schema", () => {
		expect(tool.name).toBe(REPORT_TOOL_NAME);
		expect(tool.inputSchema).toMatchObject({
			type: "object",
			required: ["outcome", "summary"],
		});
	});

	test("acknowledges a valid report and rejects an invalid one", async () => {
		const { execute } = tool;
		if (!execute) throw new Error("expected a server tool");
		expect(await execute({ outcome: "fail", summary: "x" })).toBe(REPORT_ACK);
		expect(() => execute({ outcome: "maybe" })).toThrow(/Invalid report/);
	});
});

describe("stepReport: true keeps today's tool", () => {
	test("the same description and input schema", () => {
		const tool = reportStepTool(true);
		expect(tool.description).toBe(
			"Report the outcome of your task to Night Shift. Call it exactly once, at the end.",
		);
		expect(tool.inputSchema).toEqual({
			type: "object",
			properties: {
				outcome: {
					type: "string",
					enum: ["pass", "fail", "needs-input"],
					description:
						'"pass": the task is done. "fail": it is not. "needs-input": a person must decide or provide something.',
				},
				summary: {
					type: "string",
					description: "One or two sentences about the result.",
				},
			},
			required: ["outcome", "summary"],
			additionalProperties: false,
		});
		expect(reportStepTool().inputSchema).toEqual(tool.inputSchema);
	});

	test("the instructions are today's texts", () => {
		expect(toolReportInstruction(DEFAULT_RULES)).toBe(TOOL_REPORT_INSTRUCTION);
		expect(textReportInstruction(DEFAULT_RULES)).toBe(TEXT_REPORT_INSTRUCTION);
	});

	test("an empty spec is the same as true", () => {
		expect(reportRules({})).toEqual(DEFAULT_RULES);
		expect(reportRules({ outcomes: [] })).toEqual(DEFAULT_RULES);
		expect(reportRules(false)).toBeUndefined();
		expect(
			stepReportSetup(
				{ prompt: "p", permissionMode: "auto", stepReport: {} },
				[],
			).prompt,
		).toBe(`p\n\n${TOOL_REPORT_INSTRUCTION}`);
	});
});

const REVIEW: StepReportSpec = {
	outcomes: [
		{ name: "approved", description: "the change can merge" },
		{ name: "changes-requested" },
	],
	output: {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		properties: { issues: { type: "array", items: { $ref: "#/$defs/issue" } } },
		required: ["issues"],
		$defs: { issue: { type: "string" } },
	},
};

describe("a spec with its own outcomes and an output schema", () => {
	const rules = reportRules(REVIEW) as ReportRules;

	test("the tool: outcome enum, outcomes in the description, data required", () => {
		const tool = reportStepTool(REVIEW);
		expect(tool.description).toContain(
			'Outcomes: "approved" (the change can merge), "changes-requested".',
		);
		expect(tool.inputSchema).toEqual({
			type: "object",
			properties: {
				outcome: {
					type: "string",
					enum: ["approved", "changes-requested"],
					description:
						'One of: "approved" (the change can merge), "changes-requested".',
				},
				summary: {
					type: "string",
					description: "One or two sentences about the result.",
				},
				data: {
					type: "object",
					properties: {
						issues: { type: "array", items: { $ref: "#/$defs/issue" } },
					},
					required: ["issues"],
					description: "The structured result of your task.",
				},
			},
			required: ["outcome", "summary", "data"],
			additionalProperties: false,
			// Moved to the root, so the reference still resolves.
			$defs: { issue: { type: "string" } },
		});
	});

	test("the tool checks the outcome and that data is there, not its shape", async () => {
		const { execute } = reportStepTool(REVIEW);
		if (!execute) throw new Error("expected a server tool");
		expect(
			await execute({
				outcome: "approved",
				summary: "x",
				data: { issues: [] },
			}),
		).toBe(REPORT_ACK);
		expect(
			await execute({ outcome: "approved", summary: "x", data: "anything" }),
		).toBe(REPORT_ACK);
		expect(() => execute({ outcome: "pass", summary: "x", data: {} })).toThrow(
			/"approved" \| "changes-requested"/,
		);
		expect(() => execute({ outcome: "approved", summary: "x" })).toThrow(
			/data/,
		);
	});

	test("the tool instruction names the outcomes and data", () => {
		const setup = stepReportSetup(
			{ prompt: "Review", permissionMode: "default", stepReport: REVIEW },
			undefined,
		);
		expect(setup.withTool).toBe(true);
		expect(setup.prompt).toBe(`Review\n\n${toolReportInstruction(rules)}`);
		expect(setup.prompt).toContain(
			'Pick the outcome that fits: "approved" (the change can merge), "changes-requested".',
		);
		expect(setup.prompt).toContain("`data`");
		expect(setup.prompt).not.toContain('"pass"');
	});

	test("plan mode: the text instruction carries the outcomes and the schema", () => {
		const setup = stepReportSetup(
			{ prompt: "Review", permissionMode: "plan", stepReport: REVIEW },
			undefined,
		);
		expect(setup.withTool).toBe(false);
		expect(setup.prompt).toContain(
			'NIGHTSHIFT-REPORT: {"outcome": "approved", "summary": "One or two sentences about the result.", "data": <the structured result>}',
		);
		expect(setup.prompt).toContain(JSON.stringify(REVIEW.output));
	});

	test.each([
		[
			{ outcome: "approved", summary: " ok ", data: { issues: [] } },
			{ outcome: "approved", summary: "ok", data: { issues: [] } },
		],
		// Null is data: the engine decides whether the schema allows it.
		[
			{ outcome: "changes-requested", summary: "x", data: null },
			{ outcome: "changes-requested", summary: "x", data: null },
		],
		// An object sent as JSON text is read as the object.
		[
			{ outcome: "approved", summary: "x", data: '{"issues": ["a"]}' },
			{ outcome: "approved", summary: "x", data: { issues: ["a"] } },
		],
		// Text that is not JSON stays text: the engine reports the mismatch.
		[
			{ outcome: "approved", summary: "x", data: "no issues" },
			{ outcome: "approved", summary: "x", data: "no issues" },
		],
		[{ outcome: "approved", summary: "x" }, undefined],
		[{ outcome: "pass", summary: "x", data: {} }, undefined],
	] as Array<[unknown, StepReport | undefined]>)(
		"parse %p",
		(input, expected) => {
			expect(parseStepReport(input, rules)).toEqual(expected);
		},
	);

	test("a text report with a custom outcome and data", () => {
		expect(
			parseTextReport(
				'Reviewed.\nNIGHTSHIFT-REPORT: {"outcome": "changes-requested", "summary": "Two.", "data": {"issues": ["a", "b"]}}',
				rules,
			),
		).toEqual({
			outcome: "changes-requested",
			summary: "Two.",
			data: { issues: ["a", "b"] },
		});
	});

	test("without an output schema, data is dropped", () => {
		const own = reportRules({ outcomes: [{ name: "done" }] }) as ReportRules;
		expect(
			parseStepReport({ outcome: "done", summary: "x", data: 1 }, own),
		).toEqual({ outcome: "done", summary: "x" });
		expect(reportInputSchema(own)).not.toHaveProperty("properties.data");
	});

	test("a string schema keeps JSON text as text", () => {
		const own = reportRules({ output: { type: "string" } }) as ReportRules;
		expect(
			parseStepReport({ outcome: "pass", summary: "x", data: "[1]" }, own),
		).toEqual({ outcome: "pass", summary: "x", data: "[1]" });
	});

	test("default outcomes with an output schema", () => {
		const own = reportRules({ output: { type: "array" } }) as ReportRules;
		expect(own.outcomes.map((o) => o.name)).toEqual([
			"pass",
			"fail",
			"needs-input",
		]);
		expect(toolReportInstruction(own)).toContain(TOOL_REPORT_INSTRUCTION);
		expect(reportInputSchema(own)).toMatchObject({
			properties: { data: { type: "array" } },
			required: ["outcome", "summary", "data"],
		});
	});
});

describe("a spec without an outcome (a checker picks it)", () => {
	const spec: StepReportSpec = {
		outcome: false,
		output: { type: "object", properties: { pr: { type: "string" } } },
	};
	const rules = reportRules(spec) as ReportRules;

	test("the tool asks for summary and data only", () => {
		const tool = reportStepTool(spec);
		expect(tool.description).toBe(
			"Report the result of your task to Night Shift. Call it exactly once, at the end.",
		);
		expect(tool.inputSchema).toMatchObject({
			required: ["summary", "data"],
		});
		expect(
			(tool.inputSchema as { properties: Record<string, unknown> }).properties,
		).not.toHaveProperty("outcome");
	});

	test("a report without an outcome is valid, and its outcome is empty", () => {
		expect(
			parseStepReport({ summary: " done ", data: { pr: "1" } }, rules),
		).toEqual({
			outcome: "",
			summary: "done",
			data: { pr: "1" },
		});
		// An outcome the agent sends anyway is ignored.
		expect(
			parseStepReport({ outcome: "nope", summary: "x", data: {} }, rules)
				?.outcome,
		).toBe("");
	});

	test("the instructions do not ask for an outcome", () => {
		expect(toolReportInstruction(rules)).not.toContain("outcome");
		const text = textReportInstruction(rules);
		expect(text).toContain(
			'NIGHTSHIFT-REPORT: {"summary": "One or two sentences about the result.", "data": <the structured result>}',
		);
		expect(text).not.toContain("Pick the outcome");
	});
});
