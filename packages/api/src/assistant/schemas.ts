import {
	agentHarnessSchema,
	type BuiltinCheck,
	type BuiltinStatus,
	builtinAgentIdSchema,
	type ChatEvent,
	deciderNameSchema,
	type ExplanationEvent,
	flowSchema,
	type SuggestionEvent,
	suggestionSchema,
} from "@nightshift/flows";
import { z } from "zod";

import { flowIssueSchema } from "../flows";
import { exact } from "../output";

const usageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	costUsd: z.number().optional(),
});

const commonEvents = [
	z.object({ type: z.literal("activity"), text: z.string() }),
	z.object({ type: z.literal("usage"), usage: usageSchema }),
	z.object({ type: z.literal("error"), message: z.string() }),
	z.object({ type: z.literal("done") }),
] as const;

/** What a suggestion streams: what the agent does, then the suggestion. */
export const suggestionEventSchema = exact<SuggestionEvent>()(
	z.discriminatedUnion("type", [
		...commonEvents,
		z.object({ type: z.literal("suggestion"), suggestion: suggestionSchema }),
	]),
);

/** What an explanation of a run streams: what the agent does, then the answer. */
export const explanationEventSchema = exact<ExplanationEvent>()(
	z.discriminatedUnion("type", [
		...commonEvents,
		z.object({ type: z.literal("answer"), answer: z.string() }),
	]),
);

/** What one answer in a chat streams: its text, and maybe a new version of the flow. */
export const chatEventSchema = exact<ChatEvent>()(
	z.discriminatedUnion("type", [
		...commonEvents,
		z.object({ type: z.literal("thread"), threadId: z.string() }),
		z.object({ type: z.literal("text"), delta: z.string() }),
		z.object({
			type: z.literal("proposal"),
			proposal: z.object({
				flow: flowSchema,
				summary: z.string(),
				issues: z.array(flowIssueSchema),
			}),
		}),
	]),
);

/** What answers for a built-in agent: an agent or a model. Null: nothing can. */
const builtinAnswersBySchema = z
	.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("agent"),
			profile: z.string().nullable(),
			harness: agentHarnessSchema,
			model: z.string(),
			effort: z.string().optional(),
		}),
		z.object({
			kind: z.literal("model"),
			profile: z.string().optional(),
			decider: deciderNameSchema,
			model: z.string().optional(),
		}),
	])
	.nullable();

/** Who answers for one of Night Shift's own agents on this computer now. */
export const builtinStatusSchema = exact<BuiltinStatus>()(
	z.object({
		id: builtinAgentIdSchema,
		chosen: z.boolean(),
		answers: builtinAnswersBySchema,
		problem: z.string().nullable(),
	}),
);

/** What the check of one of Night Shift's own agents found. */
export const builtinCheckSchema = exact<BuiltinCheck>()(
	z.object({
		id: builtinAgentIdSchema,
		ok: z.boolean(),
		ms: z.number(),
		answers: builtinAnswersBySchema,
		problem: z.string().nullable(),
	}),
);
