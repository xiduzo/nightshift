/**
 * How Night Shift reads a step report an agent sent: the input of a
 * `report_step` call, a `NIGHTSHIFT-REPORT:` line, and what a failed
 * result says about a report that was refused. See `step-report.ts`.
 */
import { learningNotes } from "@nightshift/flows";
import type { AgentAskBrief } from "../port";
import {
	DEFAULT_RULES,
	MAX_BACKGROUND,
	MAX_BRIEF_TEXT,
	MAX_LEARNING_LENGTH,
	MAX_LEARNINGS,
	outcomeNames,
	REPORT_MARKER,
	type ReportRules,
	type StepReport,
} from "./step-report";

/** The start of the error `reportStepTool` gives an invalid report. */
export const INVALID_REPORT_TEXT = "Invalid report. Expected";

/**
 * The start of the error `reportStepTool` gives a report whose `data` does
 * not match the output schema. Such a report still counts (see
 * `isRefusedReport`): a later report replaces it, and when none comes the
 * engine ends the step with what is wrong with the data.
 */
export const INVALID_DATA_TEXT =
	"The report was not recorded: `data` does not match its schema.";

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
 * a permission denial. False for a report that was lost on the way, and
 * for one whose `data` did not match (`INVALID_DATA_TEXT`): the engine
 * judges that data, so the step ends with what is wrong with it.
 */
export function isRefusedReport(text: string): boolean {
	if (text.includes(INVALID_DATA_TEXT)) return false;
	return REFUSED_REPORT.test(text);
}

/**
 * Check a report: an outcome of the rules, a string summary, and `data`
 * when the rules have an output schema. Returns undefined when it is not a
 * valid report. `data` is passed on as is (the tool and the engine check it), except
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
