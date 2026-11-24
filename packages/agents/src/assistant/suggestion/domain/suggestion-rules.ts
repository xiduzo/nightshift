/**
 * A suggestion for one field of one node, or of the flow: one read-only session that
 * answers with a step report whose `data` is the suggestion. The answer is
 * checked on the draft as the person would get it; an answer that does not
 * pass is sent back once with its problems, in the same session.
 */
import {
	applySuggestion,
	type FlowPlace,
	isFlowSuggestion,
	NODE_TYPE_LABEL,
	nodeOutcomes,
	proposalIssues,
	type Suggestion,
	type SuggestionKind,
	type SuggestionRequest,
	suggestionSchema,
	takesSuggestion,
} from "@nightshift/flows";
import { z } from "zod";
import type { AssistantReport } from "./session";

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
 * suggestion applied, in the draft's place as the editor checks it. Only
 * errors the suggestion adds count: the draft's own stay the person's.
 */
export function checkSuggestion(
	request: SuggestionRequest,
	report: AssistantReport,
	place: FlowPlace,
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
	const before = new Set(
		proposalIssues(request.flow, request.flow, place)
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message),
	);
	const applied = applySuggestion(
		request.flow,
		request.nodeId,
		suggestion,
		request.selection,
	);
	for (const issue of proposalIssues(request.flow, applied, place)) {
		if (issue.severity === "error" && !before.has(issue.message)) {
			problems.push(issue.message);
		}
	}
	return problems.length > 0 ? { problems } : { suggestion };
}
