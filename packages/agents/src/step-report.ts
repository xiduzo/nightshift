/**
 * The step report: how an agent tells the harness whether its step passed.
 *
 * Two channels, picked by permission mode:
 * - Tool (every mode except `plan`): the harness gives the agent one TanStack
 *   AI tool, `report_step`. The Claude Code adapter bridges it into the
 *   session over MCP, so the agent sees it as `mcp__tanstack__report_step`,
 *   and the harness adds that name to `--allowedTools` so it never prompts.
 * - Text (`plan`): plan mode denies every MCP tool, even an allowed one (the
 *   bridge cannot mark a tool read-only). The agent ends its final message
 *   with a `NIGHTSHIFT-REPORT: {...}` line instead.
 *
 * The translator turns either one into a `report` event (see `translate.ts`).
 */
import { toolDefinition } from "@tanstack/ai";
import { BRIDGED_MCP_SERVER_NAME } from "@tanstack/ai-claude-code";
import type { AgentSessionInput, StepReportOutcome } from "./types";

/** The tool name as the application registers it with `chat({ tools })`. */
export const REPORT_TOOL_NAME = "report_step";

/** The tool name as Claude Code sees it, for `--allowedTools`. */
export const REPORT_TOOL_ID = `mcp__${BRIDGED_MCP_SERVER_NAME}__${REPORT_TOOL_NAME}`;

/** What the tool returns to the agent after a valid report. */
export const REPORT_ACK = "Step report recorded.";

const OUTCOMES: readonly StepReportOutcome[] = ["pass", "fail", "needs-input"];

export type StepReport = { outcome: StepReportOutcome; summary: string };

/** The line prefix of a text report. */
export const REPORT_MARKER = "NIGHTSHIFT-REPORT:";

const OUTCOME_RULE =
	'Use outcome "pass" when the task is done, "fail" when it is not, and "needs-input" when you need a person to decide or provide something.';

/** Appended to the prompt when the session reports with the tool. */
export const TOOL_REPORT_INSTRUCTION = [
	`When you are done, call the \`${REPORT_TOOL_NAME}\` tool exactly once, as your last action.`,
	OUTCOME_RULE,
	"Put a one or two sentence summary of the result in `summary`.",
].join(" ");

/** Appended to the prompt when the session reports with text (plan mode). */
export const TEXT_REPORT_INSTRUCTION = [
	"When you are done, end your final message with exactly one line in this format:",
	`${REPORT_MARKER} {"outcome": "pass", "summary": "One or two sentences about the result."}`,
	OUTCOME_RULE,
].join("\n");

export type StepReportSetup = {
	/** The prompt to send, with the report instruction appended. */
	prompt: string;
	/** `--allowedTools`, with the report tool added when it is used. */
	allowedTools: string[] | undefined;
	/** Pass the `report_step` tool to `chat()`. */
	withTool: boolean;
};

/** What a step report adds to a session. Unchanged input without `stepReport`. */
export function stepReportSetup(
	input: Pick<AgentSessionInput, "prompt" | "stepReport" | "permissionMode">,
	allowedTools: string[] | undefined,
): StepReportSetup {
	if (!input.stepReport) {
		return { prompt: input.prompt, allowedTools, withTool: false };
	}
	if (input.permissionMode === "plan") {
		return {
			prompt: `${input.prompt}\n\n${TEXT_REPORT_INSTRUCTION}`,
			allowedTools,
			withTool: false,
		};
	}
	return {
		prompt: `${input.prompt}\n\n${TOOL_REPORT_INSTRUCTION}`,
		allowedTools: [...new Set([...(allowedTools ?? []), REPORT_TOOL_ID])],
		withTool: true,
	};
}

/** True for the report tool, with or without the bridge's MCP prefix. */
export function isReportTool(name: string | undefined): boolean {
	return name === REPORT_TOOL_NAME || name === REPORT_TOOL_ID;
}

/** Validate the tool input. Returns undefined when it is not a valid report. */
export function parseStepReport(input: unknown): StepReport | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const { outcome, summary } = input as Record<string, unknown>;
	if (!OUTCOMES.includes(outcome as StepReportOutcome)) return undefined;
	if (typeof summary !== "string") return undefined;
	return { outcome: outcome as StepReportOutcome, summary: summary.trim() };
}

/**
 * Read a text report: the last `NIGHTSHIFT-REPORT: {...}` line of the text.
 * Returns undefined when there is none or it is not a valid report.
 */
export function parseTextReport(text: string): StepReport | undefined {
	const lines = text.split(/\r?\n/).reverse();
	for (const line of lines) {
		const trimmed = line.trim().replace(/^`+|`+$/g, "");
		if (!trimmed.startsWith(REPORT_MARKER)) continue;
		try {
			return parseStepReport(
				JSON.parse(trimmed.slice(REPORT_MARKER.length).trim()),
			);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * The `report_step` tool. It only validates and acknowledges: the report
 * itself is read from the tool call in the stream. An invalid input throws,
 * so the agent gets an error result and can call again.
 */
export function reportStepTool() {
	return toolDefinition({
		name: REPORT_TOOL_NAME,
		description:
			"Report the outcome of your task to Night Shift. Call it exactly once, at the end.",
		inputSchema: {
			type: "object",
			properties: {
				outcome: {
					type: "string",
					enum: [...OUTCOMES],
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
		},
	}).server((args: unknown) => {
		if (!parseStepReport(args)) {
			throw new Error(
				`Invalid report. Expected { outcome: ${OUTCOMES.map((o) => `"${o}"`).join(" | ")}, summary: string }.`,
			);
		}
		return REPORT_ACK;
	});
}
