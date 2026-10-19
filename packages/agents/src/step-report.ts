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
 * `stepReport: true` asks for `pass`, `fail` or `needs-input`. A spec sets
 * its own outcomes and a JSON Schema for the report's `data`: the tool's
 * input schema then has `outcome` as an enum of those outcomes and a required
 * `data` property that carries the JSON Schema as is. TanStack AI takes a
 * plain JSON Schema as a tool's `inputSchema` and the MCP bridge advertises
 * it unchanged, so the model sees the exact schema. The harness only checks
 * the outcome and that `data` is there; validating `data` is the engine's job.
 *
 * The translator turns either channel into a `report` event (see `translate.ts`).
 */
import { toolDefinition } from "@tanstack/ai";
import { BRIDGED_MCP_SERVER_NAME } from "@tanstack/ai-claude-code";
import type {
	AgentSessionInput,
	StepReportOutcome,
	StepReportSpec,
} from "./types";

/** The tool name as the application registers it with `chat({ tools })`. */
export const REPORT_TOOL_NAME = "report_step";

/** The tool name as Claude Code sees it, for `--allowedTools`. */
export const REPORT_TOOL_ID = `mcp__${BRIDGED_MCP_SERVER_NAME}__${REPORT_TOOL_NAME}`;

/** What the tool returns to the agent after a valid report. */
export const REPORT_ACK = "Step report recorded.";

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
};

/** The line prefix of a text report. */
export const REPORT_MARKER = "NIGHTSHIFT-REPORT:";

const OUTCOME_RULE =
	'Use outcome "pass" when the task is done, "fail" when it is not, and "needs-input" when you need a person to decide or provide something.';

const DEFAULT_OUTCOME_DESCRIPTION =
	'"pass": the task is done. "fail": it is not. "needs-input": a person must decide or provide something.';

const SUMMARY_RULE =
	"Put a one or two sentence summary of the result in `summary`.";

const TOOL_DESCRIPTION =
	"Report the outcome of your task to Night Shift. Call it exactly once, at the end.";

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

/** What a session's report may hold: its outcomes and the `data` schema. */
export type ReportRules = {
	outcomes: { name: string; description?: string }[];
	output?: Record<string, unknown>;
	/** The default outcomes: the prompt and tool keep today's texts. */
	defaultOutcomes: boolean;
	/** False: the agent reports no outcome (a checker picks it). */
	withOutcome: boolean;
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
	};
}

const outcomeNames = (rules: ReportRules) => rules.outcomes.map((o) => o.name);

/** `"approved" (the change can merge), "changes-requested"`. */
function outcomeList(rules: ReportRules): string {
	return rules.outcomes
		.map(({ name, description }) =>
			description?.trim()
				? `${JSON.stringify(name)} (${description.trim()})`
				: JSON.stringify(name),
		)
		.join(", ");
}

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
				]
			: []),
	].join(" ");
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
	].join("\n");
}

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
		allowedTools: [...new Set([...(allowedTools ?? []), REPORT_TOOL_ID])],
		withTool: true,
	};
}

/** True for the report tool, with or without the bridge's MCP prefix. */
export function isReportTool(name: string | undefined): boolean {
	return name === REPORT_TOOL_NAME || name === REPORT_TOOL_ID;
}

/**
 * Check a report: an outcome of the rules, a string summary, and `data`
 * when the rules have an output schema. Returns undefined when it is not a
 * valid report. `data` is passed on as is (the engine validates it), except
 * an object or array sent as JSON text, which models do now and then.
 */
export function parseStepReport(
	input: unknown,
	rules: ReportRules = DEFAULT_RULES,
): StepReport | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const { outcome, summary, data } = input as Record<string, unknown>;
	if (rules.withOutcome) {
		if (typeof outcome !== "string") return undefined;
		if (!outcomeNames(rules).includes(outcome)) return undefined;
	}
	if (typeof summary !== "string") return undefined;
	if (rules.output && data === undefined) return undefined;
	return {
		outcome: rules.withOutcome ? (outcome as string) : "",
		summary: summary.trim(),
		...(rules.output ? { data: unwrapJsonText(data, rules.output) } : {}),
	};
}

/**
 * `data` as the object or array it encodes, when it is JSON text and the
 * schema does not ask for a string. Anything else is returned as is.
 */
function unwrapJsonText(
	data: unknown,
	schema: Record<string, unknown>,
): unknown {
	if (typeof data !== "string") return data;
	const type = schema.type;
	if (type === "string" || (Array.isArray(type) && type.includes("string"))) {
		return data;
	}
	try {
		const parsed: unknown = JSON.parse(data);
		return typeof parsed === "object" && parsed !== null ? parsed : data;
	} catch {
		return data;
	}
}

/**
 * Read a text report: the last `NIGHTSHIFT-REPORT: {...}` line of the text.
 * Returns undefined when there is none or it is not a valid report.
 */
export function parseTextReport(
	text: string,
	rules: ReportRules = DEFAULT_RULES,
): StepReport | undefined {
	const lines = text.split(/\r?\n/).reverse();
	for (const line of lines) {
		const trimmed = line.trim().replace(/^`+|`+$/g, "");
		if (!trimmed.startsWith(REPORT_MARKER)) continue;
		try {
			return parseStepReport(
				JSON.parse(trimmed.slice(REPORT_MARKER.length).trim()),
				rules,
			);
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** Schema keywords that only mean something at a schema's root. */
const ROOT_ONLY = new Set(["$schema", "$id", "$defs", "definitions"]);

/**
 * The tool's input schema. The output schema becomes the `data` property;
 * its `$defs` / `definitions` move to the root, so `#/$defs/...` references
 * still resolve.
 */
export function reportInputSchema(rules: ReportRules): Record<string, unknown> {
	const outcome = {
		type: "string",
		enum: outcomeNames(rules),
		description: rules.defaultOutcomes
			? DEFAULT_OUTCOME_DESCRIPTION
			: `One of: ${outcomeList(rules)}.`,
	};
	const summary = {
		type: "string",
		description: "One or two sentences about the result.",
	};
	const head = rules.withOutcome ? { outcome, summary } : { summary };
	const required = rules.withOutcome ? ["outcome", "summary"] : ["summary"];
	if (!rules.output) {
		return {
			type: "object",
			properties: head,
			required,
			additionalProperties: false,
		};
	}
	const data: Record<string, unknown> = {};
	const root: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(rules.output)) {
		if (key === "$defs" || key === "definitions") root[key] = value;
		else if (!ROOT_ONLY.has(key)) data[key] = value;
	}
	if (data.description === undefined) {
		data.description = "The structured result of your task.";
	}
	return {
		type: "object",
		properties: { ...head, data },
		required: [...required, "data"],
		additionalProperties: false,
		...root,
	};
}

/**
 * The `report_step` tool. It only checks and acknowledges: the report
 * itself is read from the tool call in the stream. An invalid input throws,
 * so the agent gets an error result and can call again.
 */
export function reportStepTool(
	stepReport: boolean | StepReportSpec | undefined = true,
) {
	const rules = reportRules(stepReport) ?? DEFAULT_RULES;
	const expected = [
		...(rules.withOutcome
			? [
					`outcome: ${outcomeNames(rules)
						.map((o) => JSON.stringify(o))
						.join(" | ")}`,
				]
			: []),
		"summary: string",
		...(rules.output ? ["data: (see the schema)"] : []),
	].join(", ");
	return toolDefinition({
		name: REPORT_TOOL_NAME,
		description: !rules.withOutcome
			? "Report the result of your task to Night Shift. Call it exactly once, at the end."
			: rules.defaultOutcomes
				? TOOL_DESCRIPTION
				: `${TOOL_DESCRIPTION} Outcomes: ${outcomeList(rules)}.`,
		inputSchema: reportInputSchema(rules),
	}).server((args: unknown) => {
		if (!parseStepReport(args, rules)) {
			throw new Error(`Invalid report. Expected { ${expected} }.`);
		}
		return REPORT_ACK;
	});
}
