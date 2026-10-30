import type {
	Artifact,
	OwnDevice,
	Placement,
	RunDetail,
	RunStreamItem,
	RunSummary,
	StepDetail,
	TranscriptEntry,
} from "@nightshift/engine";
import { flowSchema, outcomeColorSchema } from "@nightshift/flows";
import { z } from "zod";

import { deviceProfileSchema } from "../config";
import { exact } from "../output";

/**
 * The output schemas of the run views: a run, its steps and their
 * transcript, and the Devices a run can run on. Each mirrors the engine's
 * view type exactly (`exact`).
 */

export const runStatusSchema = z.enum([
	"running",
	"failed",
	"waiting",
	"sleeping",
	"finished",
	"stopped",
	"interrupted",
]);

/**
 * What a run warning is about: a cost that is not known, or a guard of the
 * run policy (the budget or a turn limit, no activity, a loop).
 */
const runWarningKindSchema = z.enum([
	"cost-unknown",
	"budget",
	"stalled",
	"looping",
]);

/** How the End node that ended a run says it came out. */
export const runResultSchema = z.enum(["done", "nothing-to-do", "failed"]);

/** The Device that walks a run, or one a run or a step runs on. */
export const runWalkerSchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	thisDevice: z.boolean(),
});

/** When nobody answered a Gate by `at` (epoch ms), it takes `choose`. */
export const gateDeadlineSchema = z.object({
	at: z.number(),
	choose: z.string(),
});

/** One choice of a Gate. */
export const gateChoiceSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	color: outcomeColorSchema.optional(),
	/** The choice needs a note: the answer an Agent goes on with. */
	needsNote: z.literal(true).optional(),
});

const runTriggerSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("manual") }),
	z.object({
		kind: z.literal("schedule"),
		scheduleId: z.string(),
		at: z.number(),
	}),
	z.object({
		kind: z.literal("webhook"),
		scheduleId: z.string(),
		at: z.number(),
	}),
]);

const costFields = {
	costUsd: z.number(),
	costEstimated: z.boolean(),
	costMissing: z.number(),
	costCalls: z.number(),
};

/** A time a step slept; `to` is null while it sleeps. Older Hosts send no sleeps. */
const sleepSchema = z.object({ from: z.number(), to: z.number().nullable() });

/**
 * How long a run or a step took, its agents' time and tokens, its Gates'
 * wait, how sure its cost is, and the pull request it opened. Older Hosts
 * send none.
 */
const metricsSchema = z.object({
	wallMs: z.number().nullable(),
	agentMs: z.number(),
	gateWaitMs: z.number(),
	tokens: z.object({
		input: z.number(),
		output: z.number(),
		cacheRead: z.number(),
		cacheWrite: z.number(),
	}),
	/** `billed`: every cost was reported. `estimated`: part is priced from tokens. `unknown`: part is not known. */
	costBasis: z.enum(["billed", "estimated", "unknown"]),
	prUrl: z.string().nullable(),
});

export const runSummarySchema = exact<RunSummary>()(
	z.object({
		id: z.string(),
		projectId: z.string(),
		walker: runWalkerSchema,
		device: runWalkerSchema,
		trigger: runTriggerSchema,
		startedBy: z
			.object({ id: z.string(), name: z.string().nullable() })
			.nullable(),
		flowName: z.string().nullable(),
		title: z.string(),
		worktreePath: z.string(),
		branch: z.string(),
		baseRef: z.string(),
		status: runStatusSchema,
		reason: z.string().nullable(),
		result: runResultSchema.nullable(),
		wakeAt: z.number().nullable(),
		signal: z.string().nullable(),
		inputs: z.record(z.string(), z.json()),
		stopAt: z.number().nullable(),
		stopAfterStep: z.boolean(),
		createdAt: z.number(),
		endedAt: z.number().nullable(),
		...costFields,
		warnings: z.array(
			z.object({
				kind: runWarningKindSchema,
				message: z.string(),
				stepId: z.string().nullable(),
				nodeId: z.string().nullable(),
				at: z.number(),
			}),
		),
		subflows: z.array(
			z.object({
				flowName: z.string(),
				status: runStatusSchema,
				...costFields,
				startedAt: z.number(),
				endedAt: z.number().nullable(),
			}),
		),
		gates: z.array(
			z.object({ openedAt: z.number(), closedAt: z.number().nullable() }),
		),
		sleeps: z.array(sleepSchema).optional(),
		metrics: metricsSchema.optional(),
	}),
);

const scopeSchema = z.object({
	parentStepId: z.string(),
	itemId: z.string().nullable(),
});

const itemSummarySchema = z.object({
	id: z.string(),
	title: z.string(),
	url: z.string().nullable(),
	/** Only in the step's detail (`runs.step`). Older Hosts send it in every summary. */
	value: z.json().optional(),
	state: z.enum(["done", "running", "failed", "blocked", "halted"]),
	branch: z.string().nullable(),
	baseBranch: z.string().nullable(),
	startedAt: z.number(),
	endedAt: z.number().nullable(),
	reason: z.string().nullable(),
});

const sessionSummarySchema = z.object({
	id: z.string(),
	harnessSessionId: z.string().nullable(),
	/** Only in the step's detail (`runs.step`). Older Hosts send it in every summary. */
	prompt: z.string().optional(),
	createdAt: z.number(),
	outcome: z.enum(["failed", "finished", "stopped", "interrupted"]).nullable(),
	error: z.string().nullable(),
	costUsd: z.number().nullable(),
	costEstimated: z.boolean(),
});

/** One visit of one node. */
const stepSummarySchema = z.object({
	id: z.string(),
	nodeId: z.string(),
	nodeType: z.enum([
		"value",
		"agent",
		"command",
		"decision",
		"call",
		"wait",
		"tool",
		"end",
		"join",
	]),
	visit: z.number(),
	startedAt: z.number(),
	endedAt: z.number().nullable(),
	outcome: z.string().nullable(),
	outputs: z.record(z.string(), z.json()),
	error: z.string().nullable(),
	scope: scopeSchema.nullable(),
	items: z.array(itemSummarySchema),
	sessions: z.array(sessionSummarySchema),
	...costFields,
	device: runWalkerSchema.nullable(),
	gate: z
		.object({
			question: z.string(),
			choices: z.array(gateChoiceSchema),
			openedAt: z.number(),
			deadline: gateDeadlineSchema.nullable(),
		})
		.nullable(),
	sleeps: z.array(sleepSchema).optional(),
	metrics: metricsSchema.optional(),
});

/** One step with the prompt of each session and the element of each item. */
export const stepDetailSchema = exact<StepDetail>()(
	stepSummarySchema.extend({
		items: z.array(itemSummarySchema.extend({ value: z.json() })),
		sessions: z.array(sessionSummarySchema.extend({ prompt: z.string() })),
	}),
);

export const runDetailSchema = exact<RunDetail>()(
	runSummarySchema.extend({
		flow: flowSchema,
		calledFlows: z.record(z.string(), flowSchema),
		flowRevision: z.string().nullable(),
		steps: z.array(stepSummarySchema),
		traversals: z.record(z.string(), z.number()),
		calledTraversals: z.array(
			z.object({
				scope: scopeSchema,
				traversals: z.record(z.string(), z.number()),
			}),
		),
		takeOverCommand: z.string().nullable(),
		resumes: z.array(
			z.object({
				at: z.number(),
				by: z.enum(["daemon", "person"]),
				nodeId: z.string(),
				reason: z.string().nullable(),
				action: z.enum(["resume", "rerun", "restart"]),
			}),
		),
		commands: z.array(
			z.object({
				id: z.string(),
				kind: z.enum(["gate.resolve", "signal.send", "run.stop", "run.move"]),
				createdAt: z.number(),
			}),
		),
		handOffs: z.array(
			z.object({
				at: z.number(),
				stepId: z.string().nullable(),
				from: runWalkerSchema,
				to: runWalkerSchema,
				commit: z.string(),
			}),
		),
		variables: z.array(
			z.object({
				scope: scopeSchema.nullable(),
				name: z.string(),
				value: z.json(),
				stepId: z.string().nullable(),
				/** A start value an earlier run kept (`keep`), not `initial`. */
				kept: z.literal(true).optional(),
				at: z.number(),
			}),
		),
	}),
);

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
			"usage-limit",
			"network",
			"device-offline",
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
		type: z.literal("tool-call"),
		connection: z.string(),
		tool: z.string(),
		arguments: z.record(z.string(), z.json()),
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

/** A Device a run of the project can run on. */
export const placementSchema = exact<Placement>()(
	z.object({
		deviceId: z.string(),
		name: z.string(),
		thisDevice: z.boolean(),
		offers: z.array(z.string()).optional(),
		ownerName: z.string().optional(),
		lastRun: z.boolean().optional(),
		default: z.boolean().optional(),
	}),
);

/** One of the Person's Devices, with whether it is online and has a Clone. */
export const ownDeviceSchema = exact<OwnDevice>()(
	placementSchema.omit({ lastRun: true, default: true }).extend({
		online: z.boolean(),
		hasClone: z.boolean(),
		profiles: z.array(deviceProfileSchema).optional(),
	}),
);

/** A file a run's agent kept for the person. */
export const artifactSchema = exact<Artifact>()(
	z.object({
		id: z.string(),
		stepId: z.string(),
		name: z.string(),
		title: z.string(),
		mediaType: z.string(),
		size: z.number(),
		savedAt: z.number(),
	}),
);
