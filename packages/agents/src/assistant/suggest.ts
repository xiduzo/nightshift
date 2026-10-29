/**
 * A suggestion for one field of one node, or of the flow: one read-only session that
 * answers with a step report whose `data` is the suggestion. The answer is
 * checked on the draft as the person would get it; an answer that does not
 * pass is sent back once with its problems, in the same session.
 */
import {
	type AgentProfileSettings,
	type AssistantUsage,
	applySuggestion,
	isFlowSuggestion,
	NODE_TYPE_LABEL,
	nodeOutcomes,
	proposalIssues,
	type Suggestion,
	type SuggestionEvent,
	type SuggestionKind,
	type SuggestionRequest,
	suggestionSchema,
	takesSuggestion,
} from "@nightshift/flows";
import { z } from "zod";
import type { AgentHarness } from "../port";
import { readProjectFacts } from "./project-facts";
import { retryPrompt } from "./prompts";
import { type AssistantReport, runAssistantSession } from "./session";
import { suggestionPrompt } from "./suggestion-prompt";

/** How many times the agent may answer: once, and once more with the problems. */
export const SUGGESTION_ATTEMPTS = 2;

/** The contract's suggestion of one kind, as a zod object. */
function variantOf(kind: SuggestionKind) {
	const variant = suggestionSchema.options.find(
		(option) => option.shape.kind.value === kind,
	);
	if (!variant) throw new Error(`No suggestion of kind "${kind}".`);
	return variant;
}

/**
 * The JSON Schema of a report's `data` for a suggestion of `kind`: the
 * contract's shape without `kind` and `note` (the note is the report's
 * summary). Defaults stay optional, as a flow file writes them.
 */
export function suggestionDataSchema(
	kind: SuggestionKind,
): Record<string, unknown> {
	const shape = (
		variantOf(kind) as unknown as {
			omit: (keys: Record<string, true>) => z.ZodType;
		}
	).omit({ kind: true, note: true });
	const { $schema: _schema, ...schema } = z.toJSONSchema(shape, {
		io: "input",
		unrepresentable: "any",
	}) as Record<string, unknown>;
	return schema;
}

/** The field of a node a kind fills, in "A Command node has no … to suggest". */
const NODE_FIELD: Record<SuggestionKind, string> = {
	prompt: "a prompt",
	output: "output data",
	set: "variable writes",
	outcomes: "outcomes",
	rules: "rules (a rule must decide it)",
	expression: "expression (a rule must make it)",
	command: "command",
	arguments: "tool to call yet",
	description: "description",
	inputs: "inputs",
};

/** Why a suggestion of this kind cannot be made for this node, or null. */
export function cannotSuggest(
	request: Pick<SuggestionRequest, "flow" | "nodeId" | "kind">,
): string | null {
	if (isFlowSuggestion(request.kind)) return null;
	const node = request.flow.nodes.find((n) => n.id === request.nodeId);
	if (!node) {
		return `The flow has no step "${request.nodeId ?? ""}". Save or reload the flow, then try again.`;
	}
	if (!takesSuggestion(node, request.kind)) {
		return `A ${NODE_TYPE_LABEL[node.type]} node has no ${NODE_FIELD[request.kind]} to suggest.`;
	}
	return null;
}

/** The problems a suggestion of one kind has on its own, before the flow's checks. */
function kindProblems(
	request: SuggestionRequest,
	suggestion: Suggestion,
): string[] {
	const node = request.flow.nodes.find((n) => n.id === request.nodeId);
	switch (suggestion.kind) {
		case "prompt":
			return suggestion.text.trim() === "" ? ["`text` is empty."] : [];
		case "output":
			return suggestion.output.type !== "object"
				? ['`output` must be a JSON Schema with `"type": "object"`.']
				: [];
		case "expression":
			return suggestion.expression.trim() === ""
				? ["`expression` is empty."]
				: [];
		case "command":
			return suggestion.command.trim() === "" ? ["`command` is empty."] : [];
		case "description":
			return suggestion.description.trim() === ""
				? ["`description` is empty."]
				: [];
		case "outcomes": {
			const current = node ? nodeOutcomes(node) : [];
			return suggestion.outcomes
				.filter((o) => o.from !== undefined && !current.includes(o.from))
				.map(
					(o) =>
						`\`${o.name}\`: \`from\` is "${o.from}", which is not an outcome of this node. Use one of ${current.map((n) => `\`${n}\``).join(", ")}, or leave \`from\` out.`,
				);
		}
		case "rules": {
			const options =
				node?.type === "decision" ? node.options.map((o) => o.name) : [];
			return suggestion.rules
				.filter((rule) => !options.includes(rule.option))
				.map(
					(rule) =>
						`"${rule.option}" is not an option of this node. Use one of ${options.map((n) => `\`${n}\``).join(", ")}.`,
				);
		}
		case "arguments":
			return argumentProblems(request.toolSchema, suggestion.arguments);
		default:
			return [];
	}
}

/** The required arguments a call leaves out, and the ones the tool does not take. */
function argumentProblems(
	schema: Record<string, unknown> | undefined,
	args: Record<string, string>,
): string[] {
	const properties =
		schema?.properties && typeof schema.properties === "object"
			? Object.keys(schema.properties)
			: null;
	if (!properties) return [];
	const required = Array.isArray(schema?.required)
		? schema.required.filter((n): n is string => typeof n === "string")
		: [];
	return [
		...required
			.filter((name) => (args[name] ?? "").trim() === "")
			.map((name) => `The argument \`${name}\` is required. Give it a value.`),
		...(schema?.additionalProperties === true
			? []
			: Object.keys(args)
					.filter((name) => !properties.includes(name))
					.map(
						(name) =>
							`The tool takes no argument \`${name}\`. Use one of ${properties.map((n) => `\`${n}\``).join(", ")}.`,
					)),
	];
}

/** `nodes.0.prompt` from a zod path. */
function at(path: readonly PropertyKey[]): string {
	return path.map(String).join(".");
}

/**
 * The suggestion in a report, or the problems the agent must fix: the
 * shape of the contract, then the checks of the flow on the draft with the
 * suggestion applied. Only errors the suggestion adds count: the draft's
 * own stay the person's.
 */
export function checkSuggestion(
	request: SuggestionRequest,
	report: AssistantReport,
): { suggestion: Suggestion } | { problems: string[] } {
	const data =
		typeof report.data === "object" && report.data !== null ? report.data : {};
	const parsed = suggestionSchema.safeParse({
		...data,
		kind: request.kind,
		note: report.summary,
	});
	if (!parsed.success) {
		return {
			problems: parsed.error.issues.map((issue) =>
				issue.path.length > 0
					? `\`${at(issue.path)}\`: ${issue.message}`
					: issue.message,
			),
		};
	}
	let suggestion = parsed.data;
	const problems: string[] = kindProblems(request, suggestion);
	if (suggestion.kind === "set") {
		// A variable the flow declares keeps its own definition.
		const declared = new Set(
			(request.flow.variables ?? []).map((variable) => variable.name),
		);
		suggestion = {
			...suggestion,
			variables: suggestion.variables.filter((v) => !declared.has(v.name)),
		};
	}
	const options = { name: request.flowName };
	const before = new Set(
		proposalIssues(request.flow, request.flow, options)
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message),
	);
	const applied = applySuggestion(
		request.flow,
		request.nodeId,
		suggestion,
		request.selection,
	);
	for (const issue of proposalIssues(request.flow, applied, options)) {
		if (issue.severity === "error" && !before.has(issue.message)) {
			problems.push(issue.message);
		}
	}
	return problems.length > 0 ? { problems } : { suggestion };
}

const sum = (a: AssistantUsage, b: AssistantUsage): AssistantUsage => {
	const costUsd =
		a.costUsd !== undefined || b.costUsd !== undefined
			? (a.costUsd ?? 0) + (b.costUsd ?? 0)
			: undefined;
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		...(costUsd !== undefined ? { costUsd } : {}),
	};
};

export type SuggestFieldInput = {
	request: SuggestionRequest;
	/** The harness that answers, as this computer runs it. */
	harness: AgentHarness;
	profile: Pick<AgentProfileSettings, "model" | "effort">;
	/** The project's Clone on this computer. */
	cwd: string;
	signal: AbortSignal;
};

/**
 * Stream one suggestion: what the agent does, what it used, then the
 * suggestion and `done`, or an `error`. Never throws.
 */
export async function* suggestField(
	input: SuggestFieldInput,
): AsyncGenerator<SuggestionEvent> {
	const { request, harness, profile, cwd, signal } = input;
	const refusal = cannotSuggest(request);
	if (refusal) {
		yield { type: "error", message: refusal };
		return;
	}
	const output = suggestionDataSchema(request.kind);
	// A command is only as good as the scripts it names: read them first.
	const facts = request.kind === "command" ? await readProjectFacts(cwd) : null;
	const first = suggestionPrompt(request, facts);
	let spent: AssistantUsage | null = null;
	let sessionId: string | null = null;
	let problems: string[] = [];
	for (let attempt = 0; attempt < SUGGESTION_ATTEMPTS; attempt++) {
		const resume: string | undefined =
			attempt > 0 && sessionId ? sessionId : undefined;
		const prompt: string =
			attempt === 0
				? first
				: resume
					? retryPrompt(problems)
					: `${first}\n\n${retryPrompt(problems)}`;
		let last: AssistantUsage | null = null;
		let report: AssistantReport | null = null;
		let ended = false;
		for await (const event of runAssistantSession({
			harness,
			profile,
			cwd,
			prompt,
			...(resume ? { resumeSessionId: resume } : {}),
			report: { output },
			signal,
		})) {
			switch (event.type) {
				case "session":
					sessionId = event.sessionId;
					break;
				case "activity":
					yield event;
					break;
				case "usage":
					last = event.usage;
					yield {
						type: "usage",
						usage: spent ? sum(spent, event.usage) : event.usage,
					};
					break;
				case "error":
					yield { type: "error", message: event.message };
					return;
				case "end":
					if (event.sessionId) sessionId = event.sessionId;
					report = event.report;
					ended = true;
					break;
				default:
					break;
			}
		}
		if (last) spent = spent ? sum(spent, last) : last;
		if (!ended) {
			yield { type: "error", message: "The agent stopped without an answer." };
			return;
		}
		if (!report) {
			problems = [
				"You ended without a report. Report the suggestion: the note in `summary`, the suggestion in `data`.",
			];
			continue;
		}
		const checked = checkSuggestion(request, report);
		if ("suggestion" in checked) {
			yield { type: "suggestion", suggestion: checked.suggestion };
			yield { type: "done" };
			return;
		}
		problems = checked.problems;
	}
	yield {
		type: "error",
		message: `The agent could not make a suggestion that works in this flow: ${problems[0] ?? "it gave no answer"} Try again, or say more in your instruction.`,
	};
}
