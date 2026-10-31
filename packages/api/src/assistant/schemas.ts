import {
	type ChatEvent,
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
