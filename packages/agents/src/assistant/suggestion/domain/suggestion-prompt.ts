/**
 * The prompt of a field suggestion: one shared frame (the role, the draft,
 * the person's instruction, the guide to flows) around one task per kind.
 * Each kind brings its own instruction and its own context: exactly what
 * that field needs, such as the outgoing edges for outcomes or the
 * project's scripts for a command. The kinds are in the files beside this
 * one, by what they fill: `prompt-kind.ts`, `outcomes-kind.ts`,
 * `data-kinds.ts`, `jsonata-kinds.ts`, `command-kind.ts`, `flow-kinds.ts`.
 */
import {
	type Flow,
	type FlowNode,
	flowAuthoringGuide,
	isFlowSuggestion,
	type SuggestionKind,
	type SuggestionRequest,
} from "@nightshift/flows";
import { commandKind } from "./command-kind";
import { argumentsKind, outputKind, setKind } from "./data-kinds";
import { descriptionKind, inputsKind } from "./flow-kinds";
import { expressionKind, rulesKind } from "./jsonata-kinds";
import type { FlowKind, KindPrompt } from "./kind";
import { outcomesKind } from "./outcomes-kind";
import type { ProjectFacts } from "./project-facts";
import { promptKind } from "./prompt-kind";
import { flowJson, scopeList } from "./prompts";

/** The prompt of each kind of a node: its own instruction and its own context. */
const NODE_KINDS: Record<Exclude<SuggestionKind, FlowKind>, KindPrompt> = {
	prompt: promptKind,
	output: outputKind,
	set: setKind,
	outcomes: outcomesKind,
	rules: rulesKind,
	expression: expressionKind,
	command: commandKind,
	arguments: argumentsKind,
};

/** The prompt of each kind of the flow. */
const FLOW_KINDS: Record<FlowKind, KindPrompt<{ flow: Flow }>> = {
	description: descriptionKind,
	inputs: inputsKind,
};

/** The kind's own lines: what it suggests, and its task with its context. */
function kindPrompt(
	request: SuggestionRequest,
	facts: ProjectFacts | null,
): { what: string; task: string[]; node: FlowNode | undefined } {
	const { flow, nodeId, kind } = request;
	if (isFlowSuggestion(kind)) {
		const spec = FLOW_KINDS[kind as FlowKind];
		return { what: spec.what, task: spec.task({ flow }), node: undefined };
	}
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) throw new Error(`The flow has no node "${nodeId}".`);
	const spec = NODE_KINDS[kind as Exclude<SuggestionKind, FlowKind>];
	return {
		what: spec.what,
		task: spec.task({ request, flow, node, facts }),
		node,
	};
}

/** The prompt of one suggestion. `facts`: the project's scripts, for a command. */
export function suggestionPrompt(
	request: SuggestionRequest,
	facts: ProjectFacts | null = null,
): string {
	const { flow } = request;
	const { what, task, node } = kindPrompt(request, facts);
	const instruction = request.instruction.trim();
	return [
		`You help a person build a Night Shift flow in its editor. Suggest ${what} for ${node ? "one node" : "the flow"}. You only suggest: never change a file. The person sees your suggestion and applies it or not.`,
		"",
		"Read the project in this folder when it helps you ground the answer: AGENTS.md or CLAUDE.md, the README, the package scripts, the skills (`.claude/skills`, `.agents/skills`), and the code the node works on. Read what you need, then answer. Do not explore further.",
		"",
		`# The flow "${request.flowName}" (the person's draft)`,
		"",
		"```json",
		flowJson(flow, { canvas: false }),
		"```",
		"",
		...(node
			? [
					`# The node \`${node.id}\` (${node.type})`,
					"",
					"```json",
					flowJson(node, { canvas: false }),
					"```",
					"",
					"# What a template in this node can read",
					"",
					scopeList(flow, node.id),
					"",
				]
			: []),
		"# Your task",
		"",
		...task,
		"",
		"# The person's instruction",
		"",
		instruction === ""
			? `None. Make the suggestion that fits this ${node ? "node" : "flow"} best.`
			: instruction,
		"",
		'Put a note for the person in `summary`: one or two plain sentences on what you suggest and why, in the language of their instruction. Address them as "you". Do not name tools or files of Night Shift itself.',
		"",
		"---",
		"",
		"For reference, how Night Shift flows work:",
		"",
		flowAuthoringGuide(),
	].join("\n");
}
