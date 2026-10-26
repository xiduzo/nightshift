/**
 * A suggestion for one field of one node: one read-only session that
 * answers with a step report whose `data` is the suggestion. The answer is
 * checked on the draft as the person would get it; an answer that does not
 * pass is sent back once with its problems, in the same session.
 */
import {
	type AgentProfileSettings,
	type AssistantUsage,
	applySuggestion,
	type FlowNode,
	proposalIssues,
	type Suggestion,
	type SuggestionEvent,
	type SuggestionKind,
	type SuggestionRequest,
	suggestionSchema,
} from "@nightshift/flows";
import { z } from "zod";
import type { AgentHarness } from "../port";
import { retryPrompt, suggestionPrompt } from "./prompts";
import { type AssistantReport, runAssistantSession } from "./session";

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

const NODE_FIELD: Record<SuggestionKind, string> = {
	prompt: "a prompt",
	output: "output data",
	set: "variable writes",
};

/** Why a suggestion of this kind cannot be made for this node, or null. */
export function cannotSuggest(
	request: Pick<SuggestionRequest, "flow" | "nodeId" | "kind">,
): string | null {
	const node = request.flow.nodes.find((n) => n.id === request.nodeId);
	if (!node) {
		return `The flow has no step "${request.nodeId}". Save or reload the flow, then try again.`;
	}
	if (!suggestsFor(node, request.kind)) {
		return `A ${nodeLabel(node)} node has no ${NODE_FIELD[request.kind]} to suggest.`;
	}
	return null;
}

/** Whether a suggestion of `kind` fills a field `node` has: as `applySuggestion` applies it. */
function suggestsFor(node: FlowNode, kind: SuggestionKind): boolean {
	switch (kind) {
		case "prompt":
			return (
				node.type === "agent" ||
				node.type === "decision" ||
				node.type === "value"
			);
		case "output":
			return node.type === "agent" || node.type === "value";
		case "set":
			return true;
	}
}

function nodeLabel(node: FlowNode): string {
	return node.type === "call"
		? "Subflow"
		: node.type[0]?.toUpperCase() + node.type.slice(1);
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
	const problems: string[] = [];
	if (suggestion.kind === "prompt" && suggestion.text.trim() === "") {
		problems.push("`text` is empty.");
	}
	if (suggestion.kind === "output" && suggestion.output.type !== "object") {
		problems.push('`output` must be a JSON Schema with `"type": "object"`.');
	}
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
	const first = suggestionPrompt(request);
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
