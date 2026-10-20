import { flowNameSchema, flowSchema, labelSchema } from "@nightshift/flows";
import { z } from "zod";

import { permitted, protectedProcedure } from "../procedures";

/** What starts a run: a flow file or an inline flow, and where its steps run. */
export const runStartFields = {
	projectId: z.string(),
	baseRef: z.string().min(1).optional(),
	stopAt: z.number().int().positive().optional(),
	inputs: z.record(z.string(), z.json()).optional(),
	/** The Device the run's steps run on. Default: this computer. */
	deviceId: z.string().min(1).max(64).optional(),
};
const runStartInput = z.union([
	z.object({ ...runStartFields, flowName: flowNameSchema }),
	z.object({ ...runStartFields, flow: flowSchema }),
]);

export const runs = {
	/** The Person's Devices a run of the project can run on: this computer first. */
	placements: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listPlacements(input.projectId),
		),
	list: protectedProcedure
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(({ context, input }) => context.space.listRuns(input)),
	get: protectedProcedure
		.input(z.object({ runId: z.string() }))
		.handler(({ context, input }) => context.space.getRun(input.runId)),
	/**
	 * Starts a flow file by name, or a flow given inline (a quick run), on
	 * one of the Person's Devices (`placements`; default this computer).
	 */
	start: permitted({ run: ["start"] })
		.input(runStartInput)
		.handler(({ context, input }) =>
			context.space.startRun({
				...input,
				startedBy: context.session.user.id,
			}),
		),
	stop: permitted({ run: ["stop"] })
		.input(
			z.object({
				runId: z.string(),
				when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.stopRun(input.runId, { when: input.when }),
		),
	/**
	 * Another of the Person's Devices walks the run from here on: from its
	 * archived checkpoint. Not while a step runs.
	 */
	move: permitted({ run: ["move"] })
		.input(z.object({ runId: z.string(), deviceId: z.string().min(1).max(64) }))
		.handler(({ context, input }) =>
			context.space.moveRun(input.runId, input.deviceId),
		),
	/** The Person's Devices for the project: online, with a Clone or not (a node's Device, Move to). */
	devices: protectedProcedure
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listDevices(input.projectId),
		),
	resume: permitted({ run: ["resume"] })
		.input(
			z.object({ runId: z.string(), prompt: z.string().min(1).optional() }),
		)
		.handler(({ context, input }) =>
			context.space.resumeRun(input.runId, input.prompt),
		),
	/**
	 * Stops the running step and continues it at once, with an optional
	 * follow-up prompt. With `stepId`, only while that step runs.
	 */
	restartStep: permitted({ run: ["stop", "resume"] })
		.input(
			z.object({
				runId: z.string(),
				stepId: z.string().min(1).optional(),
				prompt: z.string().min(1).optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.restartStep(input.runId, {
				...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
				...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
			}),
		),
	/**
	 * Runs a run that is not going again from a node of its own flow. An
	 * Agent node continues its last session with the prompt, or with
	 * `fresh` starts a new one.
	 */
	rerun: permitted({ run: ["resume"] })
		.input(
			z.object({
				runId: z.string(),
				nodeId: z.string().min(1),
				/** The step of that node whose session an Agent continues. Default: its latest. */
				stepId: z.string().min(1).optional(),
				prompt: z.string().min(1).optional(),
				fresh: z.boolean().optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.rerunFrom(input.runId, {
				nodeId: input.nodeId,
				...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
				...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
				...(input.fresh ? { fresh: true } : {}),
			}),
		),
	/** Live transcript and status over SSE. Replays from disk first. */
	watch: protectedProcedure
		.input(
			z.object({ runId: z.string(), afterSeq: z.number().int().optional() }),
		)
		.handler(async function* ({ context, input, signal }) {
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			yield* context.space.watchRun(input.runId, {
				signal: controller.signal,
				afterSeq: input.afterSeq,
			});
		}),
	/** Sends a signal to a run whose Wait node waits for it. */
	signal: permitted({ signal: ["send"] })
		.input(z.object({ runId: z.string(), name: labelSchema }))
		.handler(({ context, input }) =>
			context.space.signalRun(input.runId, input.name),
		),
};
