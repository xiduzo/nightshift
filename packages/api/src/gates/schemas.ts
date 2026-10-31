import type { InboxGate, OpenGate } from "@nightshift/engine";
import { askFormSchema } from "@nightshift/flows";
import { z } from "zod";

import { exact } from "../output";
import { gateChoiceSchema, gateDeadlineSchema, runWalkerSchema } from "../runs";

/** A Gate that waits for a person: what it asks, and its choices. */
export const openGateSchema = exact<OpenGate>()(
	z.object({
		/** The Space of the run. */
		spaceId: z.string(),
		runId: z.string(),
		runTitle: z.string(),
		/** The flow file the run started from. Null for a quick run. */
		flowName: z.string().nullable(),
		projectId: z.string(),
		projectName: z.string(),
		stepId: z.string(),
		nodeId: z.string(),
		/** The rendered question. */
		question: z.string(),
		choices: z.array(gateChoiceSchema),
		/**
		 * The flow author let a person answer this Gate from the lock screen:
		 * a notification may show its options as buttons. Otherwise the
		 * answer needs the app.
		 */
		lockScreen: z.boolean(),
		openedAt: z.number(),
		/** When nobody answered by `at`, Night Shift takes `choose`. */
		deadline: gateDeadlineSchema.nullable(),
		/**
		 * An Ask: the form the answer fills in, with its choices and
		 * attachments. Its one choice is `answer`. Null on every other Gate.
		 */
		form: askFormSchema.nullable(),
		walker: runWalkerSchema,
		/** An answer is on its way to the Walker. */
		answerPending: z.boolean(),
	}),
);

/** One Gate of the Needs-you inbox: an open Gate, its Space's name, and whether you may answer it. */
export const inboxGateSchema = exact<InboxGate>()(
	openGateSchema.extend({
		spaceName: z.string(),
		/** Your role in the Gate's Space allows `gate.resolve`. */
		canAnswer: z.boolean(),
	}),
);

/** The answer to one open Gate, bound to its run and step. */
export const gateAnswerSchema = z.object({
	runId: z.string().min(1),
	stepId: z.string().min(1),
	choice: z.string().min(1),
	note: z.string().optional(),
	/** The answer to an Ask: the data of its form. It must match the form. */
	data: z.json().optional(),
	/**
	 * `lock-screen`: the answer comes from a button on a notification,
	 * without an unlock. Only a Gate its author marked for the lock screen
	 * takes it.
	 */
	via: z.enum(["lock-screen"]).optional(),
});
