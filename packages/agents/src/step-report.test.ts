import { describe, expect, test } from "bun:test";
import {
	parseStepReport,
	parseTextReport,
	REPORT_ACK,
	REPORT_TOOL_ID,
	REPORT_TOOL_NAME,
	reportStepTool,
	type StepReport,
	stepReportSetup,
	TEXT_REPORT_INSTRUCTION,
	TOOL_REPORT_INSTRUCTION,
} from "./step-report";

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
