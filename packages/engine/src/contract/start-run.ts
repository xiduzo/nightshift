import {
	type Flow,
	flowNameSchema,
	flowSchema,
	type JsonValue,
} from "@nightshift/flows";
import { z } from "zod";

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
	 * The Device the run's steps run on, and its worktree's home (its
	 * Placement): one of the starter's Devices with a Clone of the project
	 * (`listPlacements`). Default: this computer.
	 */
	deviceId?: string;
	/**
	 * The run's Device by the name a schedule gives it (`Schedule.device`):
	 * the Host fires the schedule, and the run runs there. Without
	 * `deviceId` only. Default: this computer.
	 */
	deviceName?: string;
} & (
	| { flowName: string; flow?: never }
	/** A flow that is not a file, for example a quick run. */
	| { flow: Flow; flowName?: never }
);

/** The fields of a run start that a person chooses, beside its flow. */
const startFields = {
	projectId: z.string(),
	baseRef: z.string().min(1).optional(),
	stopAt: z.number().int().positive().optional(),
	inputs: z.record(z.string(), z.json()).optional(),
	deviceId: z.string().min(1).max(64).optional(),
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
