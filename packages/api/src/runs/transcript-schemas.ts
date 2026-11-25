import type {
	RunStreamItem,
	StepTranscript,
	TranscriptEntry,
} from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import { itemSummarySchema, stepSummarySchema } from "./step-schemas";
import {
	gateChoiceSchema,
	gateDeadlineSchema,
	runResultSchema,
	runStatusSchema,
} from "./summary-schemas";

/**
 * The transcript of a step: each thing that happened in it, and what a
 * watched run sends. Each output mirrors the engine's view type exactly
 * (`exact`).
 */

const agentUsageSchema = z.object({
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number().optional(),
	cacheWriteTokens: z.number().optional(),
	cacheWrite1hTokens: z.number().optional(),
	costUsd: z.number().optional(),
});

/** The tool call that started the subagent an event comes from. Absent for the session's own agent. */
const parentToolCallId = z.string().optional();

/** One file a step changed in the run's copy of the project, as git sees it. */
const worktreeFileChangeSchema = z.object({
	path: z.string(),
	oldPath: z.string().optional(),
	status: z.enum(["added", "modified", "deleted", "renamed"]),
	added: z.number(),
	removed: z.number(),
	binary: z.literal(true).optional(),
	patch: z.string().optional(),
	truncated: z.literal(true).optional(),
});

/** What happened in a step: one line of its transcript. */
const stepEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("session"),
		sessionId: z.string(),
		model: z.string().optional(),
	}),
	z.object({
		type: z.literal("text"),
		messageId: z.string(),
		delta: z.string(),
		parentToolCallId,
	}),
	z.object({
		type: z.literal("thinking"),
		messageId: z.string(),
		delta: z.string(),
		parentToolCallId,
	}),
	z.object({
		type: z.literal("tool-start"),
		toolCallId: z.string(),
		name: z.string(),
		parentToolCallId,
	}),
	z.object({
		type: z.literal("tool-end"),
		toolCallId: z.string(),
		name: z.string(),
		input: z.unknown(),
		parentToolCallId,
	}),
	z.object({
		type: z.literal("tool-result"),
		toolCallId: z.string(),
		content: z.string(),
		isError: z.literal(true).optional(),
		parentToolCallId,
	}),
	z.object({
		type: z.literal("report"),
		outcome: z.string(),
		summary: z.string(),
		data: z.unknown().optional(),
		/** What the agent proposed to learn about the project. */
		learnings: z.array(z.string()).optional(),
		/** The brief the agent gave with its question for a person. */
		ask: z
			.object({
				urgency: z.string().optional(),
				situation: z.string().optional(),
				background: z.array(z.string()).optional(),
				recommend: z
					.object({ choice: z.string(), reason: z.string().optional() })
					.optional(),
				impacts: z.record(z.string(), z.string()).optional(),
			})
			.optional(),
	}),
	z.object({ type: z.literal("usage"), usage: agentUsageSchema }),
	z.object({
		type: z.literal("finished"),
		usage: agentUsageSchema.optional(),
		limit: z.enum(["turns", "budget"]).optional(),
	}),
	z.object({
		type: z.literal("error"),
		kind: z.enum(["harness", "aborted", "usage-limit", "network"]),
		message: z.string(),
		resetAt: z.number().optional(),
	}),
	z.object({ type: z.literal("command-start"), command: z.string() }),
	z.object({
		type: z.literal("command-output"),
		stream: z.enum(["stdout", "stderr"]),
		text: z.string(),
	}),
	z.object({
		type: z.literal("command-exit"),
		exitCode: z.number().nullable(),
	}),
	z.object({
		type: z.literal("decision-start"),
		prompt: z.string(),
		labels: z.array(z.string()),
		model: z.string(),
	}),
	z.object({
		type: z.literal("decision"),
		label: z.string(),
		notes: z.string(),
	}),
	z.object({
		type: z.literal("rule"),
		matched: z.string().nullable(),
		evaluated: z.array(z.object({ option: z.string(), result: z.json() })),
	}),
	z.object({
		type: z.literal("gate-open"),
		question: z.string(),
		choices: z.array(gateChoiceSchema),
		deadline: gateDeadlineSchema.optional(),
	}),
	z.object({
		type: z.literal("gate-resolved"),
		choice: z.string(),
		note: z.string(),
		byDeadline: z.literal(true).optional(),
	}),
	z.object({
		type: z.literal("items-read"),
		count: z.number(),
		open: z.number(),
	}),
	z.object({
		type: z.literal("item-start"),
		itemId: z.string(),
		title: z.string(),
		branch: z.string().nullable(),
		baseBranch: z.string().nullable(),
	}),
	z.object({
		type: z.literal("item-end"),
		itemId: z.string(),
		state: itemSummarySchema.shape.state,
		reason: z.string().nullable(),
	}),
	z.object({
		type: z.literal("wait"),
		reason: z.enum([
			"duration",
			"time",
			"signal",
			"command",
			"any",
			"url",
			"usage-limit",
			"network",
			"device-offline",
			"lease",
		]),
		until: z.number().nullable(),
		message: z.string(),
		signal: z.string().optional(),
	}),
	z.object({ type: z.literal("wake"), signal: z.string().optional() }),
	z.object({
		type: z.literal("value-start"),
		by: z.enum(["model", "rule"]),
		source: z.string(),
		model: z.string().nullable(),
	}),
	z.object({
		type: z.literal("value"),
		data: z.json(),
		problem: z.string().nullable(),
	}),
	z.object({
		type: z.literal("convert"),
		from: z.string(),
		to: z.string(),
		bytes: z.number(),
		problem: z.string().nullable(),
	}),
	z.object({
		type: z.literal("tool-call"),
		connection: z.string(),
		tool: z.string(),
		arguments: z.record(z.string(), z.json()),
		argumentsUnknown: z.literal(true).optional(),
	}),
	z.object({
		type: z.literal("tool-called"),
		isError: z.boolean(),
		text: z.string(),
		data: z.json(),
	}),
	z.object({
		type: z.literal("end"),
		status: runResultSchema,
		message: z.string().nullable(),
		/** The End wrote a report. `cut`: Night Shift kept only its start. Absent: no report. */
		report: z.object({ cut: z.boolean() }).optional(),
	}),
	z.object({
		type: z.literal("lease"),
		name: z.string(),
		held: z.boolean(),
		holder: z.string().optional(),
		holderTitle: z.string().optional(),
	}),
	z.object({
		type: z.literal("service"),
		state: z.enum(["starting", "ready", "failed"]),
		command: z.string().optional(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("since-last-run"),
		firstRun: z.boolean(),
		remembers: z.boolean(),
		new: z.number(),
		changed: z.number(),
		same: z.number(),
	}),
	z.object({
		type: z.literal("web-request"),
		method: z.string(),
		url: z.string(),
	}),
	z.object({
		type: z.literal("web-response"),
		status: z.number().nullable(),
		text: z.string(),
		bytes: z.number().nullable(),
	}),
	z.object({ type: z.literal("worktree-snapshot"), tree: z.string() }),
	z.object({
		type: z.literal("worktree-changes"),
		from: z.string(),
		to: z.string(),
		files: z.array(worktreeFileChangeSchema),
		omitted: z.number().optional(),
		overlapped: z.literal(true).optional(),
	}),
]);

/** One line of a step's transcript. `seq` grows by one per run. */
export const transcriptEntryViewSchema = exact<TranscriptEntry>()(
	z.object({
		seq: z.number(),
		stepId: z.string(),
		sessionId: z.string().nullable(),
		at: z.number(),
		event: stepEventSchema,
	}),
);

/**
 * One step's transcript as Night Shift saved it, and how much of it the
 * entries are: `whole` (the step ended), `so-far` (it still runs) or
 * `cut` (the read stopped before the end).
 */
export const stepTranscriptSchema = exact<StepTranscript>()(
	z.object({
		entries: z.array(transcriptEntryViewSchema),
		holds: z.enum(["whole", "so-far", "cut"]),
	}),
);

export const runStreamItemSchema = exact<RunStreamItem>()(
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("transcript"),
			entry: transcriptEntryViewSchema,
		}),
		z.object({ kind: z.literal("status"), status: runStatusSchema }),
		z.object({ kind: z.literal("step"), step: stepSummarySchema }),
	]),
);
