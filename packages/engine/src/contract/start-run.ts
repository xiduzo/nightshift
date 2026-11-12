import {
	type Flow,
	flowNameSchema,
	flowSchema,
	type JsonValue,
	labelSchema,
	nodeIdSchema,
	type Outcome,
} from "@nightshift/flows";
import { z } from "zod";

/**
 * A test run's pins and skips (ADR 27): what a person marked on the nodes
 * of a saved flow in its editor. A pinned node gives the output of a step
 * of an earlier run (`runId`, `stepId`) and does not run. A skipped node
 * gives the outcome named here, with every output field empty. The flow
 * itself never holds them: they travel only with the start.
 */
export type TestRunRequest = {
	pinned?: Record<string, { runId: string; stepId: string }>;
	skipped?: Record<string, Outcome>;
};

/** The most pins and skips one test run takes, together. */
const TEST_RUN_MAX_MARKS = 50;

/** A run id or a step id, as a pin names it. */
const refIdSchema = z.string().min(1).max(64);

/** The pins and skips of a test run (`TestRunRequest`): at most 50 together. */
export const testRunRequestSchema = z
	.object({
		pinned: z
			.record(
				nodeIdSchema,
				z.object({ runId: refIdSchema, stepId: refIdSchema }),
			)
			.optional(),
		skipped: z.record(nodeIdSchema, labelSchema).optional(),
	})
	.refine(
		(test) =>
			Object.keys(test.pinned ?? {}).length +
				Object.keys(test.skipped ?? {}).length <=
			TEST_RUN_MAX_MARKS,
		{
			message: `A test run takes at most ${TEST_RUN_MAX_MARKS} pins and skips.`,
		},
	) satisfies z.ZodType<TestRunRequest>;

/** A run start: the flow, the project and what a person or a schedule chose. */
export type StartRunInput = {
	projectId: string;
	/**
	 * Values for the flow's `inputs`, by name: a string for a `text` input,
	 * any JSON value (or JSON text) for a `json` input. A missing or empty
	 * value takes the input's default; a required input without either
	 * refuses the start. Names the flow does not declare are refused.
	 */
	inputs?: Record<string, JsonValue>;
	/** Epoch ms. No new step starts after it; the run then ends as stopped. */
	stopAt?: number;
	/** Git ref to branch the worktree from. Defaults to the clone's current HEAD. */
	baseRef?: string;
	/**
	 * The Person who starts the run (their id). Commits in the run's
	 * worktree are in their name. Absent: a schedule, or nobody known.
	 */
	startedBy?: string;
	/**
	 * The Device a person picks, by its id: one of their Devices with a
	 * Clone of the project (`listPlacements`). It takes every step it can,
	 * and the Devices the flow configures are its fallbacks (ADR 17). For a
	 * schedule's run, the Replica that keeps the Space (ADR 15). Absent: the
	 * flow says where the run goes.
	 */
	deviceId?: string;
	/** The Device the person started from: the last fallback (ADR 17). Default: this computer. */
	startedFrom?: string;
} & (
	| {
			flowName: string;
			flow?: never;
			/**
			 * A test run (ADR 27): the nodes that give an earlier output or an
			 * outcome instead of running. Only a person's start of a saved flow
			 * takes it (`runs.start`).
			 */
			test?: TestRunRequest;
	  }
	/** A flow that is not a file, for example a quick run. */
	| { flow: Flow; flowName?: never; test?: never }
);

/** The fields of a run start that a person chooses, beside its flow. */
const startFields = {
	projectId: z.string(),
	baseRef: z.string().min(1).optional(),
	stopAt: z.number().int().positive().optional(),
	inputs: z.record(z.string(), z.json()).optional(),
	deviceId: z.string().min(1).max(64).optional(),
	startedFrom: z.string().min(1).max(64).optional(),
};

/**
 * A run start as a person asks for it: `StartRunInput` without its
 * starter, which the server sets from the session. The API's `runs.start`
 * and the Host's `startRun` for a Device both take it.
 */
export const startRunInputSchema = z.union([
	z.object({ ...startFields, flowName: flowNameSchema }),
	z.object({ ...startFields, flow: flowSchema }),
]) satisfies z.ZodType<StartRunInput>;

/**
 * A run start as a person asks for it in the app: `startRunInputSchema`,
 * and for a flow file a test run's pins and skips (`test`, ADR 27). Only
 * the API's `runs.start` takes it. `startRunInputSchema` stays without
 * `test`: a Host that reads a start with it would drop the pins and skips
 * and run every node for real.
 */
export const startRunRequestSchema = z.union([
	z.object({
		...startFields,
		flowName: flowNameSchema,
		test: testRunRequestSchema.optional(),
	}),
	z.object({ ...startFields, flow: flowSchema }),
]) satisfies z.ZodType<StartRunInput>;
