/**
 * What the prompt tells the agent about its step report, for each channel
 * (the tool, or a text line in plan mode), and what a step report adds to
 * a session (`stepReportSetup`). See `step-report.ts`.
 */
import type { AgentSessionInput } from "../port";
import {
	LEARNINGS_RULE,
	outcomeList,
	REPORT_MARKER,
	REPORT_TOOL_NAME,
	type ReportRules,
	reportRules,
} from "./step-report";

const OUTCOME_RULE =
	'Use outcome "pass" when the task is done, "fail" when it is not, and "needs-input" when you need a person to decide or provide something.';

const SUMMARY_RULE =
	"Put a one or two sentence summary of the result in `summary`.";

/** Appended to the prompt when the session reports with the tool. */
export const TOOL_REPORT_INSTRUCTION = [
	`When you are done, call the \`${REPORT_TOOL_NAME}\` tool exactly once, as your last action.`,
	OUTCOME_RULE,
	SUMMARY_RULE,
].join(" ");

/** Appended to the prompt when the session reports with text (plan mode). */
export const TEXT_REPORT_INSTRUCTION = [
	"When you are done, end your final message with exactly one line in this format:",
	`${REPORT_MARKER} {"outcome": "pass", "summary": "One or two sentences about the result."}`,
	OUTCOME_RULE,
].join("\n");

function outcomeRule(rules: ReportRules): string[] {
	if (!rules.withOutcome) return [];
	return [
		rules.defaultOutcomes
			? OUTCOME_RULE
			: `Pick the outcome that fits: ${outcomeList(rules)}.`,
	];
}

/** The prompt instruction for the tool channel. */
export function toolReportInstruction(rules: ReportRules): string {
	return [
		`When you are done, call the \`${REPORT_TOOL_NAME}\` tool exactly once, as your last action.`,
		...outcomeRule(rules),
		SUMMARY_RULE,
		...(rules.output
			? [
					"Put the structured result in `data`; it must match the tool's schema for `data`.",
					`When the tool answers that \`data\` does not match, fix \`data\` and call \`${REPORT_TOOL_NAME}\` again.`,
				]
			: []),
		...(rules.learnings ? [LEARNINGS_RULE] : []),
		...(rules.ask ? [askRule(rules.ask.outcome)] : []),
	].join(" ");
}

/** What the agent is asked to give with a question for a person. */
function askRule(outcome: string): string {
	return `When you report "${outcome}", also fill \`ask\`: how urgent the question is, why a person must decide, what you already did or checked, the choice you recommend, and what each choice does. Leave out what you do not know.`;
}

/** The prompt instruction for the text channel (plan mode). */
export function textReportInstruction(rules: ReportRules): string {
	const outcome = rules.withOutcome
		? `"outcome": ${JSON.stringify(rules.outcomes[0]?.name ?? "pass")}, `
		: "";
	const data = rules.output ? ', "data": <the structured result>' : "";
	return [
		"When you are done, end your final message with exactly one line in this format:",
		`${REPORT_MARKER} {${outcome}"summary": "One or two sentences about the result."${data}}`,
		...outcomeRule(rules),
		...(rules.output
			? [
					`Put the structured result in "data", on that same line. It must match this JSON Schema: ${JSON.stringify(rules.output)}`,
				]
			: []),
		...(rules.learnings
			? [`${LEARNINGS_RULE} Put it on that same line: "learnings": ["…"].`]
			: []),
	].join("\n");
}

export type StepReportSetup = {
	/** The prompt to send, with the report instruction appended. */
	prompt: string;
	/** `--allowedTools`, with the report tool added when it is used and has an id. */
	allowedTools: string[] | undefined;
	/** Pass the `report_step` tool to `chat()`. */
	withTool: boolean;
};

/**
 * What a step report adds to a session. Unchanged input without
 * `stepReport`. `reportToolId`: the report tool's name in the harness's
 * allow rules (`HarnessProfile.reportToolId`).
 */
export function stepReportSetup(
	input: Pick<AgentSessionInput, "prompt" | "stepReport" | "permissionMode">,
	allowedTools: string[] | undefined,
	reportToolId?: string,
): StepReportSetup {
	const rules = reportRules(input.stepReport);
	if (!rules) {
		return { prompt: input.prompt, allowedTools, withTool: false };
	}
	if (input.permissionMode === "plan") {
		return {
			prompt: `${input.prompt}\n\n${textReportInstruction(rules)}`,
			allowedTools,
			withTool: false,
		};
	}
	return {
		prompt: `${input.prompt}\n\n${toolReportInstruction(rules)}`,
		allowedTools: reportToolId
			? [...new Set([...(allowedTools ?? []), reportToolId])]
			: allowedTools,
		withTool: true,
	};
}
