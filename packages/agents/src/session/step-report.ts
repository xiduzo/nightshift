/**
 * The step report: how an agent tells the harness whether its step passed.
 *
 * Two channels, picked by permission mode:
 * - Tool (every mode except `plan`): the harness gives the agent one TanStack
 *   AI tool, `report_step`. The Claude Code adapter bridges it into the
 *   session over MCP, so the agent sees it as `mcp__tanstack__report_step`,
 *   and the harness adds that name to `--allowedTools` so it never prompts.
 *   The harness's profile gives that name (`HarnessProfile.reportToolId`).
 * - Text (`plan`): plan mode denies every MCP tool, even an allowed one (the
 *   bridge cannot mark a tool read-only). The agent ends its final message
 *   with a `NIGHTSHIFT-REPORT: {...}` line instead.
 *
 * `stepReport: true` asks for `pass`, `fail` or `needs-input`. A spec sets
 * its own outcomes and a JSON Schema for the report's `data`: the tool's
 * input schema then has `outcome` as an enum of those outcomes and a required
 * `data` property that carries the JSON Schema as is. TanStack AI takes a
 * plain JSON Schema as a tool's `inputSchema` and the MCP bridge advertises
 * it unchanged, so the model sees the exact schema. Most harnesses do not
 * hold a tool call to its schema, so the tool checks `data` itself with the
 * engine's own check (`outputDataProblem`). Data that does not match gets an
 * error result that says what is wrong, and the agent calls again in the
 * same session. The engine still judges the last report's data.
 *
 * The translator turns either channel into a `report` event (see `translate.ts`).
 * A valid tool report counts even when its delivery fails, unless the
 * result says it was refused (`isRefusedReport`).
 *
 * This file holds what a report is and what one may hold (`ReportRules`).
 * Beside it: what the prompt tells the agent (`step-report-prompt.ts`), how
 * a report is read (`step-report-parse.ts`), and the tool
 * (`step-report-tool.ts`).
 */
import type { AgentAskBrief, StepReportOutcome, StepReportSpec } from "../port";

/** The tool name as the application registers it with `chat({ tools })`. */
export const REPORT_TOOL_NAME = "report_step";

/** The outcomes of `stepReport: true`, and of a spec without its own. */
export const DEFAULT_OUTCOMES: readonly StepReportOutcome[] = [
	"pass",
	"fail",
	"needs-input",
];

export type StepReport = {
	/** "" when the rules ask for no outcome. */
	outcome: StepReportOutcome;
	summary: string;
	/** Only with an output schema; not validated against it. */
	data?: unknown;
	/** Only when the rules allow learnings, and the agent gave some. */
	learnings?: string[];
	/** Only when the agent may ask a person, and it gave a brief. */
	ask?: AgentAskBrief;
};

/** The line prefix of a text report. */
export const REPORT_MARKER = "NIGHTSHIFT-REPORT:";

/** The most notes one report proposes, and the longest note. */
export const MAX_LEARNINGS = 10;
export const MAX_LEARNING_LENGTH = 500;

/** The longest text of one part of an agent's brief. */
export const MAX_BRIEF_TEXT = 2000;
/** The most background items an agent's brief keeps. */
export const MAX_BACKGROUND = 20;

/** What a session's report may hold: its outcomes and the `data` schema. */
export type ReportRules = {
	outcomes: { name: string; description?: string }[];
	output?: Record<string, unknown>;
	/** The default outcomes: the prompt and tool keep today's texts. */
	defaultOutcomes: boolean;
	/** False: the agent reports no outcome (something else picks it). */
	withOutcome: boolean;
	/** The agent may add short notes it learned (`learnings`). */
	learnings?: boolean;
	/** The agent may ask a person: the brief of its question (`ask`), and the person's choices. */
	ask?: { outcome: string; choices: string[] };
};

/** The rules of `stepReport: true`. */
export const DEFAULT_RULES: ReportRules = {
	outcomes: DEFAULT_OUTCOMES.map((name) => ({ name })),
	defaultOutcomes: true,
	withOutcome: true,
};

/** The rules for a session's `stepReport`, or undefined when it is off. */
export function reportRules(
	stepReport: boolean | StepReportSpec | undefined,
): ReportRules | undefined {
	if (!stepReport) return undefined;
	if (stepReport === true) return DEFAULT_RULES;
	const own = stepReport.outcomes ?? [];
	return {
		...(own.length > 0
			? { outcomes: own, defaultOutcomes: false }
			: DEFAULT_RULES),
		withOutcome: stepReport.outcome !== false,
		...(stepReport.output ? { output: stepReport.output } : {}),
		...(stepReport.learnings ? { learnings: true } : {}),
		...(stepReport.ask ? { ask: stepReport.ask } : {}),
	};
}

export const outcomeNames = (rules: ReportRules) =>
	rules.outcomes.map((o) => o.name);

/** `"approved" (the change can merge), "changes-requested"`. */
export function outcomeList(rules: ReportRules): string {
	return rules.outcomes
		.map(({ name, description }) =>
			description?.trim()
				? `${JSON.stringify(name)} (${description.trim()})`
				: JSON.stringify(name),
		)
		.join(", ");
}

/** True for the report tool: by its own name, or by the harness's name for it. */
export function isReportTool(
	name: string | undefined,
	reportToolId?: string,
): boolean {
	return (
		name === REPORT_TOOL_NAME ||
		(reportToolId !== undefined && name === reportToolId)
	);
}
