import { startRunInputSchema } from "@nightshift/engine";
import { labelSchema } from "@nightshift/flows";
import { z } from "zod";

import { output, stream } from "../output";
import { permitted, protectedProcedure, readable } from "../procedures";
import { runProcedure } from "./run-space";
import {
	artifactSchema,
	ownDeviceSchema,
	placementSchema,
	runDetailSchema,
	runStatusSchema,
	runStreamItemSchema,
	runSummarySchema,
	stepDetailSchema,
} from "./schemas";

/** The most runs one page holds. */
const RUNS_PAGE_MAX = 200;

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
	/**
	 * Newest first. With `limit`, one page: the next page starts after the
	 * last run of this one (`cursor`). Without it, every run, as older
	 * screens ask. Older Hosts send every run whatever the input.
	 */
	list: protectedProcedure
		.route({
			summary:
				"Lists the runs of the Space, or of one project, newest first: all of them, or one page.",
		})
		.output(output(z.array(runSummarySchema)))
		.input(
			z
				.object({
					projectId: z.string().optional(),
					/** At most this many runs. */
					limit: z.number().int().min(1).max(RUNS_PAGE_MAX).optional(),
					/** The last run of the page before: the runs after it follow. */
					cursor: z
						.object({ createdAt: z.number(), id: z.string() })
						.optional(),
					/** Only runs with one of these statuses. */
					statuses: z.array(runStatusSchema).min(1).optional(),
				})
				.optional(),
		)
		.handler(({ context, input }) => context.space.listRuns(input)),
	get: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary:
				"Reads one run of any of the Person's Spaces: its flow, steps, resumes, commands and variables.",
		})
		.output(output(runDetailSchema))
		.handler(({ context, input }) => context.space.getRun(input.runId)),
	/**
	 * One step of a run with what `get` leaves out: the prompt of each
	 * session and the element of each item. A screen reads it when a
	 * person opens the step.
	 */
	step: runProcedure(z.object({ runId: z.string(), stepId: z.string() }))
		.route({
			summary:
				"Reads one step of a run with the prompt of each session and each item it ran.",
		})
		.output(output(stepDetailSchema))
		.handler(({ context, input }) =>
			context.space.getStep(input.runId, input.stepId),
		),
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
		.input(startRunInputSchema)
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
			context.space.act(input.runId, { kind: "stop", when: input.when }),
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
			context.space.act(input.runId, { kind: "move", to: input.deviceId }),
		),
	/**
	 * Lets go of a lease the run holds (ADR 7): the next run that waits for
	 * it takes it. The run goes on without it.
	 */
	releaseLease: runProcedure(
		z.object({ runId: z.string(), name: z.string().min(1).max(500) }),
		{ run: ["stop"] },
	)
		.route({
			summary: "Lets go of a lease a run holds, so another run can take it.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.act(input.runId, {
				kind: "release-lease",
				name: input.name,
			}),
		),
	/** The Person's own Devices the run can move to now, from the run's own Space ("Move to…"). */
	moveTargets: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary:
				"Lists the Person's own Devices that can walk the run from here on.",
		})
		.output(output(z.array(ownDeviceSchema)))
		.handler(({ context, input }) =>
			context.space.listMoveTargets(input.runId),
		),
	/**
	 * The Person's Devices for the project: online, with a Clone or not.
	 * With `forNode`, the Devices that node may name (a node's Device):
	 * another person's only when it offers the node's profile.
	 */
	devices: protectedProcedure
		.route({
			summary:
				"Lists the Person's Devices for a project: online or not, with a Clone or not. With forNode, the Devices that node may name.",
		})
		.output(output(z.array(ownDeviceSchema)))
		.input(
			z.object({
				projectId: z.string(),
				/** The node the Device is for: an Agent node's profile, or none. */
				forNode: z.object({ profile: z.string().min(1).optional() }).optional(),
			}),
		)
		.handler(({ context, input }) =>
			context.space.listDevices(input.projectId, input.forNode),
		),
	resume: runProcedure(
		z.object({ runId: z.string(), prompt: z.string().min(1).optional() }),
		{ run: ["resume"] },
	)
		.route({
			summary:
				"Continues a run that is not going at its last step, or wakes a sleeping one.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.act(input.runId, { kind: "resume", prompt: input.prompt }),
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
			context.space.act(input.runId, {
				kind: "restart",
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
			context.space.act(input.runId, {
				kind: "rerun",
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
		.handler(async function* ({ context, input, signal, path }) {
			const controller = new AbortController();
			signal?.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
			try {
				yield* context.space.watchRun(input.runId, {
					signal: controller.signal,
					afterSeq: input.afterSeq,
				});
			} catch (error) {
				throw readable(error, path);
			}
		}),
	/** Sends a signal to a run whose Wait node waits for it. */
	signal: runProcedure(z.object({ runId: z.string(), name: labelSchema }), {
		signal: ["send"],
	})
		.route({ summary: "Sends a signal to a run whose Wait node waits for it." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.space.act(input.runId, { kind: "signal", name: input.name }),
		),
};
