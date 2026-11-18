/**
 * One kind of suggestion in the prompt: what it suggests, and its task with
 * its context (`KindPrompt`). And the two ways every task writes a value
 * in its text.
 */
import type { Flow, FlowNode, SuggestionRequest } from "@nightshift/flows";
import type { ProjectFacts } from "./project-facts";

/** What a task builds its context from. */
export type TaskInput = {
	request: SuggestionRequest;
	flow: Flow;
	/** The node, for a kind of a node. */
	node: FlowNode;
	/** The project's scripts, for a command. */
	facts: ProjectFacts | null;
};

/** One kind: what it suggests, in the frame's first line, and its task with its context. */
export type KindPrompt<Input = TaskInput> = {
	what: string;
	task: (input: Input) => string[];
};

/** The kinds that fill a field of the flow, not of a node. */
export type FlowKind = "description" | "inputs";

export const json = (value: unknown) =>
	["```json", JSON.stringify(value, null, 2), "```"].join("\n");

export const quoted = (names: readonly string[]) =>
	names.map((name) => `\`${name}\``).join(", ");
