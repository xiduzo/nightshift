import { flowNameSchema, flowSchema } from "@nightshift/flows";
import { z } from "zod";
import type { StartRunInput } from "./engine";

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
