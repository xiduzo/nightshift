import type { OpenGate } from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";
import { gateChoiceSchema, runWalkerSchema } from "../runs";

/** A Gate that waits for a person: what it asks, and its choices. */
export const openGateSchema = exact<OpenGate>()(
	z.object({
		runId: z.string(),
		runTitle: z.string(),
		projectId: z.string(),
		projectName: z.string(),
		stepId: z.string(),
		nodeId: z.string(),
		/** The rendered question. */
		question: z.string(),
		choices: z.array(gateChoiceSchema),
		openedAt: z.number(),
		walker: runWalkerSchema,
		/** An answer is on its way to the Walker. */
		answerPending: z.boolean(),
	}),
);
