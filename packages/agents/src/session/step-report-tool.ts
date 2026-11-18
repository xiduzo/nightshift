/**
 * The `report_step` tool: its input schema, from the rules of the session's
 * report, and its check of what the agent sent. See `step-report.ts`.
 */
import { outputDataProblem } from "@nightshift/flows/json-schema";
import { toolDefinition } from "@tanstack/ai";
import { LEARNINGS_FIELD_DESCRIPTION } from "../knowledge";
import type { StepReportSpec } from "../port";
import {
	DEFAULT_RULES,
	MAX_BACKGROUND,
	MAX_LEARNINGS,
	outcomeList,
	outcomeNames,
	REPORT_TOOL_NAME,
	type ReportRules,
	reportRules,
} from "./step-report";
import {
	INVALID_DATA_TEXT,
	INVALID_REPORT_TEXT,
	parseStepReport,
} from "./step-report-parse";

/** What the tool returns to the agent after a valid report. */
export const REPORT_ACK = "Step report recorded.";

const DEFAULT_OUTCOME_DESCRIPTION =
	'"pass": the task is done. "fail": it is not. "needs-input": a person must decide or provide something.';

const TOOL_DESCRIPTION =
	"Report the outcome of your task to Night Shift. Call it exactly once, at the end.";

/** The `ask` property of the tool's input: the brief of the agent's question for a person. */
function askInputSchema(ask: NonNullable<ReportRules["ask"]>) {
	return {
		type: "object",
		description: `Only with the outcome "${ask.outcome}": what the person reads before they answer. Every part is optional.`,
		properties: {
			urgency: {
				type: "string",
				enum: ["now", "today", "later"],
				description:
					'"now": work is blocked or something breaks until the person answers. "today": the run waits, nothing breaks. "later": nothing waits on the answer.',
			},
			situation: {
				type: "string",
				description: "Why a person must decide, in one or two sentences.",
			},
			background: {
				type: "array",
				items: { type: "string" },
				maxItems: MAX_BACKGROUND,
				description:
					"What you already decided, checked or did, one fact per item. End an item with (source: X) to say where the fact comes from.",
			},
			recommend: {
				type: "object",
				properties: {
					choice: { type: "string", enum: ask.choices },
					reason: { type: "string" },
				},
				required: ["choice"],
				additionalProperties: false,
				description: "The choice you recommend, and why in one sentence.",
			},
			impacts: {
				type: "object",
				properties: Object.fromEntries(
					ask.choices.map((choice) => [choice, { type: "string" }]),
				),
				additionalProperties: false,
				description:
					"For each choice, one sentence on what happens when the person picks it.",
			},
		},
		additionalProperties: false,
	};
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
	const head = {
		...(rules.withOutcome ? { outcome, summary } : { summary }),
		...(rules.learnings
			? {
					learnings: {
						type: "array",
						items: { type: "string" },
						maxItems: MAX_LEARNINGS,
						description: LEARNINGS_FIELD_DESCRIPTION,
					},
				}
			: {}),
		...(rules.ask ? { ask: askInputSchema(rules.ask) } : {}),
	};
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
 * itself is read from the tool call in the stream. An invalid input, or
 * `data` that does not match the output schema, throws, so the agent gets
 * an error result that says what is wrong and can call again.
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
		...(rules.learnings ? ["learnings?: string[]"] : []),
		...(rules.ask
			? ["ask?: { urgency, situation, background, recommend, impacts }"]
			: []),
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
		const report = parseStepReport(args, rules);
		if (!report) {
			throw new Error(`${INVALID_REPORT_TEXT} { ${expected} }.`);
		}
		const problem = rules.output
			? outputDataProblem(rules.output, report.data)
			: null;
		if (problem !== null) {
			throw new Error(
				`${INVALID_DATA_TEXT} ${problem}. Fix \`data\` so it matches the schema, then call ${REPORT_TOOL_NAME} again.`,
			);
		}
		return REPORT_ACK;
	});
}
