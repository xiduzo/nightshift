import { startRunRequestSchema } from "@nightshift/engine";
import { labelSchema } from "@nightshift/flows";
import { z } from "zod";

import { output, stream } from "../output";
import { openedStream, permitted, protectedProcedure } from "../procedures";
import { runDetailSchema } from "./detail-schemas";
import { artifactSchema, runFilesSchema } from "./file-schemas";
import { ownDeviceSchema, placementSchema } from "./placement-schemas";
import { runProcedure, runSpaceOf } from "./run-space";
import { stepDetailSchema } from "./step-schemas";
import { runStatusSchema, runSummarySchema } from "./summary-schemas";
import {
	runStreamItemSchema,
	stepTranscriptSchema,
} from "./transcript-schemas";

/** The most runs one page holds. */
const RUNS_PAGE_MAX = 200;

/**
 * How long the read of a step's whole transcript may take. A read that
 * a Host keeps waiting answers then with what came (`cut`). It is below
 * the 10 s an assistant waits for it (`chatRun`), so that answer arrives.
 */
const STEP_TRANSCRIPT_MS = 8_000;

/**
 * Lists, starts and the Devices of a project are the session's Space's. A
 * procedure keyed by a run id goes to the engine's run use cases instead
 * (`runProcedure`): each finds the run's own Space, so a run of any of the
 * Person's Spaces opens and steers without a switch.
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
	 * Newest first: by start, or with `order: "activity"` by when each run
	 * last did something. With `limit`, one page: the next page starts
	 * after the last run of this one (`cursor`). Without it, every run, as
	 * older screens ask. Older Hosts send every run whatever the input, and
	 * a Host from before `order` sends them by start.
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
						.object({
							createdAt: z.number(),
							id: z.string(),
							/** Places the run in the order `activity`. */
							lastActivityAt: z.number().optional(),
						})
						.optional(),
					/** Only runs with one of these statuses. */
					statuses: z.array(runStatusSchema).min(1).optional(),
					/** By start (the default), or by when each run last did something. */
					order: z.enum(["started", "activity"]).optional(),
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
		.handler(({ context, input }) =>
			context.engine.runs.get(context.actor, input),
		),
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
			context.engine.runs.step(context.actor, input),
		),
	/**
	 * One step's transcript as Night Shift saved it, all at once, for a
	 * reader that needs all of it (an assistant over `nightshift mcp`).
	 * Once the step ended: all of it, wherever the run was walked. While
	 * it runs: what this computer keeps so far. `holds` says which, or
	 * `cut` when the read stopped first.
	 */
	stepTranscript: runProcedure(
		z.object({ runId: z.string(), stepId: z.string() }),
	)
		.route({
			summary:
				"Reads the saved transcript of one step of a run, all of it at once.",
		})
		.output(output(stepTranscriptSchema))
		.handler(({ context, input, signal }) => {
			const bound = AbortSignal.timeout(STEP_TRANSCRIPT_MS);
			return context.engine.runs.stepTranscript(context.actor, {
				...input,
				signal: signal ? AbortSignal.any([signal, bound]) : bound,
			});
		}),
	/**
	 * The end of a service's log (ADR 9), by its node and scope
	 * (`RunService.scopeKey`). Null when this computer does not walk the
	 * run, or the service printed nothing yet.
	 */
	serviceLog: runProcedure(
		z.object({
			runId: z.string(),
			nodeId: z.string(),
			scopeKey: z.string(),
		}),
	)
		.route({ summary: "Reads the end of the log of a service of a run." })
		.output(output(z.object({ text: z.string().nullable() })))
		.handler(async ({ context, input }) => {
			const { space } = await runSpaceOf(context, input.runId);
			return {
				text: await space.serviceLog(input.runId, {
					nodeId: input.nodeId,
					scopeKey: input.scopeKey,
				}),
			};
		}),
	/** The files the run's agents and commands kept, oldest first. Fetch one at `GET /api/runs/:id/artifacts/:artifactId`. */
	artifacts: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary: "Lists the files the agents and commands of a run kept.",
		})
		.output(output(z.array(artifactSchema)))
		.handler(async ({ context, input }) => {
			const { space } = await runSpaceOf(context, input.runId);
			return space.listArtifacts(input.runId);
		}),
	/**
	 * The files in the folder of a run of a project without a folder, on
	 * this computer, and when the cleanup removes them. Empty for a run
	 * that works in a copy of the project. Fetch one at
	 * `GET /api/runs/:id/files/<path>`.
	 */
	files: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary:
				"Lists the files in the folder of a run of a project without a folder, and when they are removed.",
		})
		.output(output(runFilesSchema))
		.handler(async ({ context, input }) => {
			const { space } = await runSpaceOf(context, input.runId);
			return space.listRunFiles(input.runId);
		}),
	/**
	 * Starts a flow file by name, or a flow given inline (a quick run). A
	 * Device it names goes first. Without one, the flow says where (ADR 17).
	 * A flow file may start as a test run, with pins and skips (`test`,
	 * ADR 27).
	 */
	start: permitted({ run: ["start"] })
		.route({
			summary:
				"Starts a run of a flow file, or of a flow given inline, or a test run of a flow file.",
		})
		.output(output(runSummarySchema))
		.input(startRunRequestSchema)
		.handler(({ context, input }) =>
			context.space.startRun({
				...input,
				startedBy: context.session.user.id,
			}),
		),
	useful: runProcedure(z.object({ runId: z.string(), useful: z.boolean() }))
		.route({
			summary: "Records whether you found this run useful.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.markUseful(context.actor, input),
		),
	stop: runProcedure(
		z.object({
			runId: z.string(),
			when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
		}),
	)
		.route({ summary: "Stops a run now, or after its running step." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.stop(context.actor, input),
		),
	/**
	 * Another of the Person's Devices walks the run from here on: from its
	 * archived checkpoint. Not while a step runs.
	 */
	move: runProcedure(
		z.object({ runId: z.string(), deviceId: z.string().min(1).max(64) }),
	)
		.route({
			summary: "Moves the walk of a run to another of the Person's Devices.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.move(context.actor, {
				runId: input.runId,
				to: input.deviceId,
			}),
		),
	/**
	 * Lets go of a lease the run holds (ADR 7): the next run that waits for
	 * it takes it. The run goes on without it.
	 */
	releaseLease: runProcedure(
		z.object({ runId: z.string(), name: z.string().min(1).max(500) }),
	)
		.route({
			summary: "Lets go of a lease a run holds, so another run can take it.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.releaseLease(context.actor, input),
		),
	/** The Person's own Devices the run can move to now, from the run's own Space ("Move to…"). */
	moveTargets: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary:
				"Lists the Person's own Devices that can walk the run from here on.",
		})
		.output(output(z.array(ownDeviceSchema)))
		.handler(({ context, input }) =>
			context.engine.runs.moveTargets(context.actor, input),
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
	)
		.route({
			summary:
				"Continues a run that is not going at its last step, or wakes a sleeping one.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.resume(context.actor, input),
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
	)
		.route({
			summary: "Stops the running step of a run and starts it again at once.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.restartStep(context.actor, input),
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
	)
		.route({ summary: "Runs a run again from one node of its own flow." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.rerun(context.actor, input),
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
		.handler(
			openedStream(({ context, input, signal }) =>
				context.engine.runs.watch(context.actor, { ...input, signal }),
			),
		),
	/**
	 * You copied or shared the command that takes the run over by hand.
	 * The run's Walker logs it once: Needed you counts it. A screen calls
	 * it without waiting and ignores a refusal: an older Host does not
	 * know it.
	 */
	takeOver: runProcedure(z.object({ runId: z.string() }))
		.route({
			summary:
				"Records that you took a run over by hand with its take-over command.",
		})
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.takeOver(context.actor, input),
		),
	/** Sends a signal to a run whose Wait node waits for it. */
	signal: runProcedure(z.object({ runId: z.string(), name: labelSchema }))
		.route({ summary: "Sends a signal to a run whose Wait node waits for it." })
		.output(output(z.void()))
		.handler(({ context, input }) =>
			context.engine.runs.signal(context.actor, input),
		),
};
