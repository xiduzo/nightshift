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
 * it unchanged, so the model sees the exact schema. The harness only checks
 * the outcome and that `data` is there; validating `data` is the engine's job.
 *
 * The translator turns either channel into a `report` event (see `translate.ts`).
 * A valid tool report counts even when its delivery fails, unless the
 * result says it was refused (`isRefusedReport`).
 */
import { learningNotes } from "@nightshift/flows";
import { toolDefinition } from "@tanstack/ai";
import { LEARNINGS_FIELD_DESCRIPTION, LEARNINGS_RULE } from "../knowledge";
import type {
	AgentAskBrief,
	AgentSessionInput,
	StepReportOutcome,
	StepReportSpec,
} from "../port";

/** The tool name as the application registers it with `chat({ tools })`. */
export const REPORT_TOOL_NAME = "report_step";

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
	/** Only when the rules allow learnings, and the agent gave some. */
	learnings?: string[];
	/** Only when the agent may ask a person, and it gave a brief. */
	ask?: AgentAskBrief;
};

/** The line prefix of a text report. */
export const REPORT_MARKER = "NIGHTSHIFT-REPORT:";

const OUTCOME_RULE =
	'Use outcome "pass" when the task is done, "fail" when it is not, and "needs-input" when you need a person to decide or provide something.';

const DEFAULT_OUTCOME_DESCRIPTION =
	'"pass": the task is done. "fail": it is not. "needs-input": a person must decide or provide something.';

const SUMMARY_RULE =
	"Put a one or two sentence summary of the result in `summary`.";

/** The most notes one report proposes, and the longest note. */
const MAX_LEARNINGS = 10;
const MAX_LEARNING_LENGTH = 500;

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

/** The start of the error `reportStepTool` gives an invalid report. */
export const INVALID_REPORT_TEXT = "Invalid report. Expected";

/**
 * What a failed `report_step` result says when the report itself was
 * refused, not lost on the way:
 * - Night Shift's own check (`reportStepTool`). It runs `parseStepReport`
 *   with the same rules as the translator, so a valid input never gets it;
 *   matching it is a guard.
 * - The harness rejected the input before the call: Claude Code's
 *   `InputValidationError`, or the MCP "invalid params" error (-32602).
 * - A permission denial: a deny rule, a hook, or a person said no. Night
 *   Shift allows the tool in every harness, so this is rare.
 * Each harness words a denial its own way and none marks it apart from
 * other failures, so this reads the words. A failure that says none of
 * this (the bridge cannot be reached, it rejects the session's credentials,
 * a timeout) is a lost delivery.
 */
const REFUSED_REPORT = new RegExp(
	[
		INVALID_REPORT_TEXT.replaceAll(".", "\\."),
		"InputValidationError",
		"MCP error -32602",
		"\\bpermission",
		"\\bdenied\\b",
		"\\bnot allowed\\b",
		"\\b(?:user|you) (?:rejected|declined|denied|refused|cancell?ed)\\b",
		"\\brejected by the user\\b",
		"(?:doesn't|does not) want to proceed",
		"prevents you from using",
	].join("|"),
	"i",
);

/**
 * True when the text of a failed `report_step` result says the report was
 * refused: by Night Shift's own check, by the harness's input check, or by
 * a permission denial. False for a report that was lost on the way.
 */
export function isRefusedReport(text: string): boolean {
	return REFUSED_REPORT.test(text);
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
	const { outcome, summary, data, learnings, ask } = input as Record<
		string,
		unknown
	>;
	if (rules.withOutcome) {
		if (typeof outcome !== "string") return undefined;
		if (!outcomeNames(rules).includes(outcome)) return undefined;
	}
	if (typeof summary !== "string") return undefined;
	if (rules.output && data === undefined) return undefined;
	const notes = rules.learnings ? learningsOf(learnings) : [];
	const brief =
		rules.ask && outcome === rules.ask.outcome ? askBriefOf(ask) : undefined;
	return {
		outcome: rules.withOutcome ? (outcome as string) : "",
		summary: summary.trim(),
		...(rules.output ? { data: unwrapJsonText(data, rules.output) } : {}),
		...(notes.length > 0 ? { learnings: notes } : {}),
		...(brief ? { ask: brief } : {}),
	};
}

/** The longest text of one part of an agent's brief. */
const MAX_BRIEF_TEXT = 2000;
/** The most background items an agent's brief keeps. */
const MAX_BACKGROUND = 20;

/**
 * The brief of an agent's question, as far as it is valid: each part that
 * is text of the right shape is kept, the rest is left out. Undefined
 * when nothing is left. A report never fails over its brief.
 */
function askBriefOf(value: unknown): AgentAskBrief | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const raw = value as Record<string, unknown>;
	const text = (part: unknown): string | undefined => {
		if (typeof part !== "string" || part.trim() === "") return undefined;
		const trimmed = part.trim();
		return trimmed.length > MAX_BRIEF_TEXT
			? `${trimmed.slice(0, MAX_BRIEF_TEXT - 1)}…`
			: trimmed;
	};
	const brief: AgentAskBrief = {};
	const urgency = text(raw.urgency);
	if (urgency) brief.urgency = urgency;
	const situation = text(raw.situation);
	if (situation) brief.situation = situation;
	if (Array.isArray(raw.background)) {
		const items = raw.background
			.map(text)
			.filter((item): item is string => item !== undefined)
			.slice(0, MAX_BACKGROUND);
		if (items.length > 0) brief.background = items;
	}
	const recommend = raw.recommend as Record<string, unknown> | undefined;
	const choice = text(recommend?.choice);
	if (choice) {
		const reason = text(recommend?.reason);
		brief.recommend = { choice, ...(reason ? { reason } : {}) };
	}
	if (typeof raw.impacts === "object" && raw.impacts !== null) {
		const impacts = Object.fromEntries(
			Object.entries(raw.impacts).flatMap(([name, impact]) => {
				const said = text(impact);
				return said ? [[name, said]] : [];
			}),
		);
		if (Object.keys(impacts).length > 0) brief.impacts = impacts;
	}
	return Object.keys(brief).length > 0 ? brief : undefined;
}

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

/**
 * The notes of `learnings`, as they are kept (`learningNotes`), and what one
 * report may carry: at most `MAX_LEARNINGS` of `MAX_LEARNING_LENGTH`
 * characters. Anything else is none: a report never fails over its learnings.
 */
function learningsOf(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return learningNotes(
		value.filter((note): note is string => typeof note === "string"),
	)
		.slice(0, MAX_LEARNINGS)
		.map((note) =>
			note.length > MAX_LEARNING_LENGTH
				? `${note.slice(0, MAX_LEARNING_LENGTH - 1)}…`
				: note,
		);
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
		if (!parseStepReport(args, rules)) {
			throw new Error(`${INVALID_REPORT_TEXT} { ${expected} }.`);
		}
		return REPORT_ACK;
	});
}
