import { flowNameSchema, flowSchema, labelSchema } from "@nightshift/flows";
import { z } from "zod";

import { output, stream } from "../output";
import { permitted, protectedProcedure } from "../procedures";
import { runProcedure } from "./run-space";
import {
	artifactSchema,
	ownDeviceSchema,
	placementSchema,
	runDetailSchema,
	runStreamItemSchema,
	runSummarySchema,
} from "./schemas";

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

/**
 * Lists, starts and the Devices of a project are the session's Space's. A
 * procedure keyed by a run id goes to the run's own Space instead
 * (`runProcedure`): a run of any of the Person's Spaces opens and steers
 * without a switch.
 */
export const runs = {
	/** The Person's Devices a run of the project can run on: this computer first. */
	placements: protectedProcedure
		.route({
			summary:
				"Lists the Devices a run of the project can run on, this computer first.",
		})
		.output(output(z.array(placementSchema)))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listPlacements(input.projectId),
		),
	list: protectedProcedure
		.route({ summary: "Lists the runs of the Space, or of one project." })
		.output(output(z.array(runSummarySchema)))
		.input(z.object({ projectId: z.string().optional() }).optional())
		.handler(({ context, input }) => context.space.listRuns(input)),
	get: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary:
				"Reads one run of any of the Person's Spaces: its flow, steps, resumes, commands and variables.",
		})
		.output(output(runDetailSchema))
		.handler(({ context, input }) => context.space.getRun(input.runId)),
	/** The files the run's agents kept, oldest first. Fetch one at `GET /api/runs/:id/artifacts/:artifactId`. */
	artifacts: runProcedure(z.object({ runId: z.string() }))
		.route({ summary: "Lists the files the agents of a run kept." })
		.output(output(z.array(artifactSchema)))
		.handler(({ context, input }) => context.space.listArtifacts(input.runId)),
	/**
	 * Starts a flow file by name, or a flow given inline (a quick run), on
	 * one of the Person's Devices (`placements`; default this computer).
	 */
	start: permitted({ run: ["start"] })
		.route({
			summary: "Starts a run of a flow file, or of a flow given inline.",
		})
		.output(output(runSummarySchema))
		.input(runStartInput)
		.handler(({ context, input }) =>
			context.space.startRun({
				...input,
				startedBy: context.session.user.id,
			}),
		),
	stop: runProcedure(
		z.object({
			runId: z.string(),
			when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
		}),
		{ run: ["stop"] },
	)
		.route({ summary: "Stops a run now, or after its running step." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.stopRun(input.runId, { when: input.when }),
		),
	/**
	 * Another of the Person's Devices walks the run from here on: from its
	 * archived checkpoint. Not while a step runs.
	 */
	move: runProcedure(
		z.object({ runId: z.string(), deviceId: z.string().min(1).max(64) }),
		{ run: ["move"] },
	)
		.route({
			summary: "Moves the walk of a run to another of the Person's Devices.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.moveRun(input.runId, input.deviceId),
		),
	/** The Person's Devices for the project: online, with a Clone or not (a node's Device, Move to). */
	devices: protectedProcedure
		.route({
			summary:
				"Lists the Person's Devices for a project: online or not, with a Clone or not.",
		})
		.output(output(z.array(ownDeviceSchema)))
		.input(z.object({ projectId: z.string() }))
		.handler(({ context, input }) =>
			context.space.listDevices(input.projectId),
		),
	resume: runProcedure(
		z.object({ runId: z.string(), prompt: z.string().min(1).optional() }),
		{ run: ["resume"] },
	)
		.route({
			summary:
				"Continues a stopped, failed or interrupted run at its last step.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.resumeRun(input.runId, input.prompt),
		),
	/**
	 * Stops the running step and continues it at once, with an optional
	 * follow-up prompt. With `stepId`, only while that step runs.
	 */
	restartStep: runProcedure(
		z.object({
			runId: z.string(),
			stepId: z.string().min(1).optional(),
			prompt: z.string().min(1).optional(),
		}),
		{ run: ["stop", "resume"] },
	)
		.route({
			summary: "Stops the running step of a run and starts it again at once.",
		})
		.output(output(z.void()))
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
	rerun: runProcedure(
		z.object({
			runId: z.string(),
			nodeId: z.string().min(1),
			/** The step of that node whose session an Agent continues. Default: its latest. */
			stepId: z.string().min(1).optional(),
			prompt: z.string().min(1).optional(),
			fresh: z.boolean().optional(),
		}),
		{ run: ["resume"] },
	)
		.route({ summary: "Runs a run again from one node of its own flow." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.rerunFrom(input.runId, {
				nodeId: input.nodeId,
				...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
				...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
				...(input.fresh ? { fresh: true } : {}),
			}),
		),
	/** Live transcript and status over SSE. Replays from disk first. */
	watch: runProcedure(
		z.object({ runId: z.string(), afterSeq: z.number().int().optional() }),
	)
		.route({
			summary:
				"Streams the status, steps and transcript of a run: what is saved first, then live.",
		})
		.output(stream(runStreamItemSchema))
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
	signal: runProcedure(z.object({ runId: z.string(), name: labelSchema }), {
		signal: ["send"],
	})
		.route({ summary: "Sends a signal to a run whose Wait node waits for it." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.signalRun(input.runId, input.name),
		),
};
