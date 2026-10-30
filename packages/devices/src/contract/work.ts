import type { DecisionInput, ValueInput } from "@nightshift/agents/types";
import type {
	CapabilityQuery,
	ExecInput,
	OfferedSessionInput,
	RunRef,
	SessionInput,
	ToolCallInput,
} from "@nightshift/engine";
import {
	agentHarnessSchema,
	deciderNameSchema,
	effortSchema,
	permissionModeSchema,
} from "@nightshift/flows";
import { z } from "zod";
import { exact } from "./described";

/**
 * The wire of the work relay: a call of the Device port as plain data
 * (`WorkRequest`), the answers of the placed Device (`WorkReply`), what a
 * placed Device takes from its Host (`WorkDelivery`), and the transport
 * (`WorkRelay`). `work/` makes and serves the calls.
 */

/** Who asks a placed Device for work, and for which run. */
export type WorkFor = {
	spaceId: string;
	projectId: string;
	/** The Person who starts (or started) the run, as the Host knows them. */
	personId: string;
	/** Null before the run exists: its start asks for capabilities and flows first. */
	runId: string | null;
};

/** One call of the Device port, as plain data. */
export type WorkCall =
	| { kind: "capabilities"; query: CapabilityQuery }
	| { kind: "flows" }
	| { kind: "worktree"; run: RunRef }
	| {
			kind: "itemBranch";
			cwd: string;
			name: string;
			base: string | null;
			fallback: string;
	  }
	| { kind: "handOff"; cwd: string; runBranch: string }
	| { kind: "receiveHandOff"; run: RunRef; branch: string; commit: string }
	| {
			kind: "session";
			input: Omit<SessionInput, "signal"> | Omit<OfferedSessionInput, "signal">;
	  }
	| { kind: "exec"; input: Omit<ExecInput, "signal"> }
	| { kind: "callTool"; input: Omit<ToolCallInput, "signal"> }
	| {
			kind: "decide";
			input: Omit<DecisionInput, "signal"> | Omit<ValueInput, "signal">;
	  };

export type WorkRequest = WorkFor & { call: WorkCall };

export const WORK_KINDS = [
	"capabilities",
	"flows",
	"worktree",
	"itemBranch",
	"handOff",
	"receiveHandOff",
	"session",
	"exec",
	"callTool",
	"decide",
] as const satisfies readonly WorkCall["kind"][];

/**
 * A request as the placed Device reads it: the checked part strictly, the
 * call's input as the Device port types it (the local Device reads it as
 * it would a local call).
 */
export const workRequestSchema = z.object({
	spaceId: z.string().min(1),
	projectId: z.string().min(1),
	personId: z.string().min(1),
	runId: z.string().min(1).nullable(),
	call: z.looseObject({ kind: z.enum(WORK_KINDS) }),
});

/** One answer of a placed Device to a call. */
export type WorkReply =
	/** One item of a streaming call: a `SessionEvent` or an `ExecEvent`. */
	| { kind: "item"; item: unknown }
	/** The answer of a call that answers once. */
	| { kind: "result"; value: unknown }
	/**
	 * The call failed or was refused there; the message is for people.
	 * `offline`: the Device could not be reached, or went away mid-call.
	 */
	| { kind: "error"; message: string; offline?: boolean };

export const workReplySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("item"), item: z.unknown() }),
	z.object({ kind: z.literal("result"), value: z.unknown() }),
	z.object({
		kind: z.literal("error"),
		message: z.string(),
		offline: z.boolean().optional(),
	}),
]);

/** How the Walker reaches a placed Device. */
export type WorkRelay = {
	/**
	 * Sends one call and streams its replies. Aborting `signal` cancels the
	 * call on the Device and ends the stream. A Device that cannot be
	 * reached answers with an error.
	 */
	call(
		deviceId: string,
		request: WorkRequest,
		signal?: AbortSignal,
	): AsyncIterable<WorkReply>;
	/** Whether the Device takes work now, for a run of that Space. */
	online(deviceId: string, spaceId: string): boolean | Promise<boolean>;
};

/** What a placed Device takes from its Host: a call to serve, or one to cancel. */
export type WorkDelivery =
	| { kind: "call"; id: string; request: WorkRequest }
	| { kind: "cancel"; id: string };

/** What a run start asks a Device about. */
const capabilityQuerySchema = z.object({
	programs: z.array(z.string()).readonly().optional(),
	profiles: z.array(z.string()).readonly().optional(),
});

/** A run, as the Device that holds its worktree sees it. */
const runRefSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	baseRef: z.string().optional(),
	author: z.object({ name: z.string(), email: z.string() }).optional(),
});

/** The step report a session asks for: the default outcomes, or its own. */
const stepReportSchema = z.union([
	z.boolean(),
	z.object({
		outcomes: z
			.array(z.object({ name: z.string(), description: z.string().optional() }))
			.optional(),
		output: z.record(z.string(), z.unknown()).optional(),
		outcome: z.boolean().optional(),
	}),
]);

/** What every session has: where it works, its prompt, the session it continues. */
const sessionFields = {
	cwd: z.string(),
	prompt: z.string(),
	resumeSessionId: z.string().optional(),
	stepReport: stepReportSchema.optional(),
	artifacts: z.object({ runId: z.string(), stepId: z.string() }).optional(),
	/** The step's turn limit, and what is left of the run's budget. */
	maxTurns: z.number().int().positive().optional(),
	maxBudgetUsd: z.number().positive().optional(),
};

/** A session the Walker resolved: its harness, model, tools and connections. */
const sessionInputSchema = z.object({
	...sessionFields,
	harness: agentHarnessSchema,
	model: z.string(),
	permissionMode: permissionModeSchema,
	effort: effortSchema.optional(),
	clis: z.array(z.string()).optional(),
	connections: z.array(z.string()).optional(),
});

/** A session of a profile the Device offers: the Device resolves the profile. */
const offeredSessionInputSchema = z.object({
	...sessionFields,
	offered: z.object({
		profile: z.string(),
		permissionMode: permissionModeSchema.optional(),
	}),
});

/** A Decision node's question, or a Value node's brief, for a decider. */
const decideInputSchema = z.union([
	z.object({
		decider: deciderNameSchema,
		prompt: z.string(),
		labels: z.array(
			z.object({ name: z.string(), description: z.string().optional() }),
		),
		model: z.string().optional(),
	}),
	z.object({
		decider: deciderNameSchema,
		prompt: z.string(),
		output: z.record(z.string(), z.unknown()),
		model: z.string().optional(),
	}),
]);

/** One call of the Device port, as plain data: the call without its signal. */
const workCallSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("capabilities"), query: capabilityQuerySchema }),
	z.object({ kind: z.literal("flows") }),
	z.object({ kind: z.literal("worktree"), run: runRefSchema }),
	z.object({
		kind: z.literal("itemBranch"),
		cwd: z.string(),
		name: z.string(),
		base: z.string().nullable(),
		fallback: z.string(),
	}),
	z.object({
		kind: z.literal("handOff"),
		cwd: z.string(),
		runBranch: z.string(),
	}),
	z.object({
		kind: z.literal("receiveHandOff"),
		run: runRefSchema,
		branch: z.string(),
		commit: z.string(),
	}),
	z.object({
		kind: z.literal("session"),
		input: z.union([sessionInputSchema, offeredSessionInputSchema]),
	}),
	z.object({
		kind: z.literal("exec"),
		input: z.object({
			command: z.string(),
			cwd: z.string(),
			env: z.record(z.string(), z.string()).optional(),
			/** Secrets by name: the Device reads their values itself. */
			secrets: z.array(z.string()).optional(),
			/** A Command step: a new file for its data, named in `NS_OUTPUT`. */
			outputFile: z.boolean().optional(),
		}),
	}),
	z.object({
		kind: z.literal("callTool"),
		input: z.object({
			connection: z.string(),
			tool: z.string(),
			arguments: z.record(z.string(), z.json()),
		}),
	}),
	z.object({ kind: z.literal("decide"), input: decideInputSchema }),
]);

/**
 * A call of a run that the Host walks, as it travels to a Device: who
 * asks, for which run, and the whole call. It describes the call;
 * `exact` keeps it equal to `WorkRequest` when the code compiles.
 */
const workRequestViewSchema = exact<WorkRequest>()(
	z.object({
		spaceId: z.string(),
		projectId: z.string(),
		personId: z.string(),
		runId: z.string().nullable(),
		call: workCallSchema,
	}),
);

/** What a placed Device takes from its Host: a call to serve, or one to cancel. */
export const workDeliverySchema = exact<WorkDelivery>()(
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("call"),
			id: z.string(),
			request: workRequestViewSchema,
		}),
		z.object({ kind: z.literal("cancel"), id: z.string() }),
	]),
);
