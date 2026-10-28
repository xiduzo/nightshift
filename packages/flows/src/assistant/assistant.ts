/**
 * The assistant: an agent on this computer (an Agent Profile, or a harness
 * and model the person picks) that helps a person build a flow while they
 * edit it. It works at design time only and never writes a flow file: it
 * suggests, the person applies, and the person saves. At run time a model
 * still never changes the graph.
 *
 * Two shapes of help share these types:
 * - a suggestion for one field of one node (its prompt, its output schema,
 *   its outcomes, its command, ...) or of the flow itself (its description,
 *   its inputs), asked from a popover next to the field;
 * - a chat about the whole flow, which answers in text and may propose a
 *   new version of the flow.
 *
 * The daemon runs both as harness sessions in the project's Clone, read
 * only, on the agent the request picks (`assistantAgentSchema`). The types here are the contract between the web app, the API and
 * the daemon; `AssistantService` is the daemon's side.
 */
import { z } from "zod";

import {
	type Flow,
	flowInputSchema,
	flowSchema,
	flowVariableSchema,
} from "../document";
import {
	agentNodeSchema,
	flowNameSchema,
	jsonSchemaSchema,
	labelSchema,
	nameSchema,
	nodeIdSchema,
	option,
	variableWriteSchema,
} from "../nodes";
import type { FlowIssue } from "../validate";

/**
 * What a suggestion fills in. Of a node: its prompt, its output schema, its
 * variable writes (`set`), an Agent's own outcomes or a Decision's options
 * (`outcomes`), a Decision's rules, a Value's expression, a Command's or a
 * Wait's command, a Tool's arguments. Of the flow: its description and its inputs.
 */
export const suggestionKinds = [
	"prompt",
	"output",
	"set",
	"outcomes",
	"rules",
	"expression",
	"command",
	"arguments",
	"description",
	"inputs",
] as const;
export const suggestionKindSchema = z.enum(suggestionKinds);
export type SuggestionKind = z.infer<typeof suggestionKindSchema>;

/** The kinds that fill a field of the flow itself: they take no node. */
const flowKinds: readonly SuggestionKind[] = ["description", "inputs"];

/** Whether a suggestion of `kind` fills a field of the flow, not of a node. */
export function isFlowSuggestion(kind: SuggestionKind): boolean {
	return flowKinds.includes(kind);
}

/** A part of a text field, by character offsets: `start` up to, not including, `end`. */
export const textRangeSchema = z.object({
	start: z.number().int().min(0),
	end: z.number().int().min(0),
});
export type TextRange = z.infer<typeof textRangeSchema>;

const agentFields = agentNodeSchema.shape;

/**
 * Which agent answers, picked as an Agent node picks its agent: an Agent
 * Profile, with `harness`, `model` and `effort` as overrides on top, or no
 * profile and its own harness and model. Nothing set: the profile for help
 * in the settings, else the first profile that works. The session is read
 * only whatever the choice: a profile's permission mode, CLI tools and
 * connections never apply.
 */
export const assistantAgentSchema = z.object({
	/** An Agent Profile of this computer, by its name: the chat runs here. */
	profile: nameSchema.optional(),
	harness: agentFields.harness,
	model: agentFields.model,
	effort: agentFields.effort,
});
export type AssistantAgent = z.infer<typeof assistantAgentSchema>;

/** Without a profile, a harness, model or effort needs both the harness and the model. */
function isCompleteAgent(agent: AssistantAgent): boolean {
	if (agent.profile !== undefined) return true;
	const chosen =
		agent.harness !== undefined ||
		agent.model !== undefined ||
		agent.effort !== undefined;
	return !chosen || (agent.harness !== undefined && agent.model !== undefined);
}

const INCOMPLETE_AGENT = {
	message: "Choose a profile, or a harness and a model.",
	path: ["harness"],
};

/** Where the assistant works: a project's flow, as the editor holds it now. */
const flowInEditor = {
	projectId: z.string().min(1),
	/** The flow's file name. */
	flowName: flowNameSchema,
	/** The editor's draft, saved or not: the assistant's base, not the file. */
	flow: flowSchema,
	...assistantAgentSchema.shape,
};

/** A request for one suggestion for one field of one node, or of the flow. */
export const suggestionRequestSchema = z
	.object({
		...flowInEditor,
		/** The node whose field it fills. Unset for a field of the flow (`isFlowSuggestion`). */
		nodeId: nodeIdSchema.optional(),
		kind: suggestionKindSchema,
		/** What the person asks for, in their words. Empty: the assistant's best guess. */
		instruction: z.string().max(4000).default(""),
		/** `prompt` only: the part of the prompt to rewrite. Unset: the whole prompt. */
		selection: textRangeSchema.optional(),
		/**
		 * `arguments` only: the tool's input schema, as its MCP server lists it
		 * to the editor. Unset: the server did not answer.
		 */
		toolSchema: jsonSchemaSchema.optional(),
	})
	.refine(isCompleteAgent, INCOMPLETE_AGENT);
export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;

/** An outcome or an option of a suggestion, and the one it replaces. */
const suggestedOutcomeSchema = option.extend({
	/** The node's outcome this one replaces: its edges move to this one. */
	from: labelSchema.optional(),
});
export type SuggestedOutcome = z.infer<typeof suggestedOutcomeSchema>;

/** One suggestion. `note` says in one or two sentences what it did and why. */
export const suggestionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("prompt"),
		/** Replaces the selection, or the whole prompt without one. */
		text: z.string(),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("output"),
		/** The node's new output schema: a JSON Schema for an object. */
		output: jsonSchemaSchema,
		note: z.string(),
	}),
	z.object({
		kind: z.literal("set"),
		/** The node's new variable writes: they replace its `set`. */
		set: z.array(variableWriteSchema),
		/** Variables the writes need that the flow does not declare yet. */
		variables: z.array(flowVariableSchema),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("outcomes"),
		/** An Agent's own outcomes or a Decision's options: they replace the node's. */
		outcomes: z.array(suggestedOutcomeSchema).min(1),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("rules"),
		/**
		 * A Decision's rules, by option. An option left out keeps its rule;
		 * an empty `when` drops it (the default option).
		 */
		rules: z.array(z.object({ option: labelSchema, when: z.string() })),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("expression"),
		/** A Value node's JSONata expression. */
		expression: z.string(),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("command"),
		/** A Command node's command, or the command a Wait node runs until it passes. */
		command: z.string(),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("arguments"),
		/** A Tool node's arguments, a template each: they replace the node's. */
		arguments: z.record(z.string(), z.string()),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("description"),
		/** The flow's description: what it does, in one or two lines. */
		description: z.string(),
		note: z.string(),
	}),
	z.object({
		kind: z.literal("inputs"),
		/** The flow's inputs: they replace its inputs. */
		inputs: z.array(flowInputSchema),
		note: z.string(),
	}),
]);
export type Suggestion = z.infer<typeof suggestionSchema>;

/** One message of a person in a chat about a flow. */
export const chatRequestSchema = z
	.object({
		...flowInEditor,
		message: z.string().min(1).max(20_000),
		/**
		 * Continue this chat. Unset: start a new one. A chat continues on
		 * another agent too: the new agent gets the conversation so far.
		 */
		threadId: z.string().min(1).optional(),
		/** A run of this flow the chat is about, for example one that failed. */
		runId: z.string().min(1).optional(),
	})
	.refine(isCompleteAgent, INCOMPLETE_AGENT);
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** What the assistant spent on one answer. */
export type AssistantUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd?: number;
};

/** A new version of the whole flow, for the person to apply or discard. */
export type FlowProposal = {
	flow: Flow;
	/** One or two sentences: what changes and why. */
	summary: string;
	/** What the validator says about `flow`. The assistant fixes errors first. */
	issues: FlowIssue[];
};

/**
 * The events both kinds of help stream, in order. `activity` is a short,
 * plain line about what the agent does now ("Reads package.json"), never a
 * raw tool name. Each stream ends with `done` or `error`.
 */
type CommonEvent =
	| { type: "activity"; text: string }
	| { type: "usage"; usage: AssistantUsage }
	| { type: "error"; message: string }
	| { type: "done" };

export type SuggestionEvent =
	| CommonEvent
	| { type: "suggestion"; suggestion: Suggestion };

export type ChatEvent =
	| CommonEvent
	/** First event of every answer: the chat to continue with `threadId`. */
	| { type: "thread"; threadId: string }
	/** More of the assistant's answer, as Markdown. */
	| { type: "text"; delta: string }
	| { type: "proposal"; proposal: FlowProposal };

/**
 * Who asks, and in which Space: the chat reads the project's other flows
 * and its runs as this Person sees them in that Space.
 */
export type AssistantScope = { spaceId: string; personId: string };

/** The daemon's assistant. Stopping: abort `signal`; the stream then ends. */
export interface AssistantService {
	suggest(
		request: SuggestionRequest,
		signal: AbortSignal,
	): AsyncIterable<SuggestionEvent>;
	chat(
		request: ChatRequest,
		signal: AbortSignal,
		scope: AssistantScope,
	): AsyncIterable<ChatEvent>;
}
