/**
 * The assistant: an agent on one of this computer's Agent Profiles that
 * helps a person build a flow while they edit it. It works at design time
 * only and never writes a flow file: it suggests, the person applies, and
 * the person saves. At run time a model still never changes the graph.
 *
 * Two shapes of help share these types:
 * - a suggestion for one field of one node (its prompt, its output schema,
 *   its variable writes), asked from a popover next to the field;
 * - a chat about the whole flow, which answers in text and may propose a
 *   new version of the flow.
 *
 * The daemon runs both as harness sessions in the project's Clone, read
 * only. The types here are the contract between the web app, the API and
 * the daemon; `AssistantService` is the daemon's side.
 */
import { z } from "zod";

import { type Flow, flowSchema, flowVariableSchema } from "../document";
import {
	flowNameSchema,
	jsonSchemaSchema,
	nodeIdSchema,
	variableWriteSchema,
} from "../nodes";
import type { FlowIssue } from "../validate";

/** What a suggestion fills in: the node's prompt, its output schema, or its variable writes (`set`). */
export const suggestionKinds = ["prompt", "output", "set"] as const;
export const suggestionKindSchema = z.enum(suggestionKinds);
export type SuggestionKind = z.infer<typeof suggestionKindSchema>;

/** A part of a text field, by character offsets: `start` up to, not including, `end`. */
export const textRangeSchema = z.object({
	start: z.number().int().min(0),
	end: z.number().int().min(0),
});
export type TextRange = z.infer<typeof textRangeSchema>;

/** Where the assistant works: a project's flow, as the editor holds it now. */
const flowInEditor = {
	projectId: z.string().min(1),
	/** The flow's file name. */
	flowName: flowNameSchema,
	/** The editor's draft, saved or not: the assistant's base, not the file. */
	flow: flowSchema,
	/** The Agent Profile to run on. Unset: the assistant's profile in the settings. */
	profile: z.string().min(1).optional(),
};

/** A request for one suggestion for one field of one node. */
export const suggestionRequestSchema = z.object({
	...flowInEditor,
	nodeId: nodeIdSchema,
	kind: suggestionKindSchema,
	/** What the person asks for, in their words. Empty: the assistant's best guess. */
	instruction: z.string().max(4000).default(""),
	/** `prompt` only: the part of the prompt to rewrite. Unset: the whole prompt. */
	selection: textRangeSchema.optional(),
});
export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;

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
]);
export type Suggestion = z.infer<typeof suggestionSchema>;

/** One message of a person in a chat about a flow. */
export const chatRequestSchema = z.object({
	...flowInEditor,
	message: z.string().min(1).max(20_000),
	/** Continue this chat. Unset: start a new one. */
	threadId: z.string().min(1).optional(),
	/** A run of this flow the chat is about, for example one that failed. */
	runId: z.string().min(1).optional(),
});
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

/** The daemon's assistant. Stopping: abort `signal`; the stream then ends. */
export interface AssistantService {
	suggest(
		request: SuggestionRequest,
		signal: AbortSignal,
	): AsyncIterable<SuggestionEvent>;
	chat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
