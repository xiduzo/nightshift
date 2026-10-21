import {
	archiveRefSchema,
	ForeignRowsError,
	feedStepSchema,
	offerCapsSchema,
	runRowsSchema,
	syncCursorsSchema,
	type TranscriptEntry,
	transcriptEntrySchema,
} from "@nightshift/engine";
import { flowNameSchema, flowSchema, labelSchema } from "@nightshift/flows";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { offerRef } from "../devices";
import { output, stream } from "../output";
import { deviceProcedure } from "../procedures";
import {
	ownDeviceSchema,
	runStartFields,
	transcriptEntryViewSchema,
} from "../runs";
import { syncBatchSchema } from "./schemas";

/**
 * The event log exchange, as a paired Device calls it on its Host with its
 * Device key: run history in and out by cursor, live, and the commands
 * for the runs it walks. The Host filters every call by the membership of
 * the key's Person.
 */
export const sync = {
	/** Rows of other Walkers after the Device's cursors, and its commands. */
	pull: deviceProcedure("sync")
		.route({
			summary:
				"Gives a paired Device the rows of other Walkers after its cursors, and its commands.",
		})
		.output(output(syncBatchSchema))
		.input(z.object({ cursors: syncCursorsSchema }))
		.handler(({ context, input }) =>
			context.exchange.pull(context.deviceKey, input.cursors),
		),
	/** The same, then every new batch as it lands. */
	stream: deviceProcedure("sync")
		.route({
			summary:
				"Streams the rows of other Walkers after a Device's cursors, then each new batch.",
		})
		.output(stream(syncBatchSchema))
		.input(z.object({ cursors: syncCursorsSchema }))
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.stream(context.deviceKey, input.cursors, signal);
		}),
	/** The Device's own rows: runs it walks, in Spaces its owner is in. */
	push: deviceProcedure("sync")
		.route({ summary: "Takes the rows of the runs a paired Device walks." })
		.output(output(z.object({ events: z.number() })))
		.input(runRowsSchema)
		.handler(async ({ context, input }) => {
			try {
				return await context.exchange.push(context.deviceKey, input);
			} catch (error) {
				if (error instanceof ForeignRowsError) {
					throw new ORPCError("FORBIDDEN", { message: error.message });
				}
				throw error;
			}
		}),
	/** A person's action on a run walked elsewhere, in the name of the key's Person. */
	command: deviceProcedure("sync")
		.route({
			summary:
				"Sends a person's action on a run walked elsewhere to its Walker.",
		})
		.output(output(z.void()))
		.input(
			z.discriminatedUnion("kind", [
				z.object({
					runId: z.string().min(1),
					kind: z.literal("gate.resolve"),
					payload: z.object({
						stepId: z.string().min(1),
						choice: z.string().min(1),
						note: z.string().optional(),
					}),
				}),
				z.object({
					runId: z.string().min(1),
					kind: z.literal("signal.send"),
					payload: z.object({ name: labelSchema }),
				}),
				z.object({
					runId: z.string().min(1),
					kind: z.literal("run.stop"),
					payload: z.object({
						when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
					}),
				}),
				z.object({
					runId: z.string().min(1),
					kind: z.literal("run.move"),
					payload: z.object({ to: z.string().min(1).max(64) }),
				}),
			]),
		)
		.handler(({ context, input }) =>
			context.exchange.command(context.deviceKey, input),
		),
	/** The Walker applied a command, or says why not. */
	commandDone: deviceProcedure("sync")
		.route({
			summary: "Takes a Walker's report that it applied a command, or why not.",
		})
		.output(output(z.void()))
		.input(
			z.object({
				id: z.string().min(1),
				error: z.string().max(2_000).nullable(),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.commandDone(context.deviceKey, input),
		),
	/** Starts a run placed on another Device, for the key's Person: this Host walks it. */
	startRun: deviceProcedure("sync")
		.route({
			summary: "Starts a run placed on another Device. This Host walks it.",
		})
		.output(output(z.object({ runId: z.string() })))
		.input(
			z.union([
				z.object({
					...runStartFields,
					flowName: flowNameSchema,
					spaceId: z.string().min(1),
					deviceId: z.string().min(1).max(64),
				}),
				z.object({
					...runStartFields,
					flow: flowSchema,
					spaceId: z.string().min(1),
					deviceId: z.string().min(1).max(64),
				}),
			]),
		)
		.handler(({ context, input }) =>
			context.exchange.startRun(context.deviceKey, input),
		),
	/** The key's Person's Devices for a project: online, with a Clone or not. */
	devices: deviceProcedure("sync")
		.route({
			summary:
				"Lists the Person's Devices for a project: online or not, with a Clone or not.",
		})
		.output(output(z.array(ownDeviceSchema)))
		.input(z.object({ spaceId: z.string().min(1), projectId: z.string() }))
		.handler(({ context, input }) =>
			context.exchange.devices(context.deviceKey, input),
		),
	/** The Device offers one of its profiles to a Space here (or changes its caps). */
	offer: deviceProcedure("sync")
		.route({
			summary:
				"Publishes a paired Device's Offer of a profile to a Space here, or its new caps.",
		})
		.output(output(z.void()))
		.input(
			offerRef.extend({
				...offerCapsSchema.shape,
				deviceName: z.string().trim().min(1).max(64),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.offer(context.deviceKey, input),
		),
	/** The Device withdraws its Offer from a Space here. */
	withdrawOffer: deviceProcedure("sync")
		.route({ summary: "Withdraws a paired Device's Offer from a Space here." })
		.output(output(z.void()))
		.input(offerRef)
		.handler(({ context, input }) =>
			context.exchange.withdrawOffer(context.deviceKey, input),
		),
	/** The Device has a Clone of a Project of a Space here. */
	addClone: deviceProcedure("sync")
		.route({
			summary:
				"Records that a paired Device has a Clone of a project of a Space here.",
		})
		.output(output(z.void()))
		.input(
			z.object({
				spaceId: z.string().min(1),
				projectId: z.string().min(1),
				deviceName: z.string().trim().min(1).max(64),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.addClone(context.deviceKey, input),
		),
};

/** The archive: the run state of runs walked elsewhere, per Space. */
export const archive = {
	/** The Walker keeps a step's transcript or command log, or its run's checkpoints, here. */
	put: deviceProcedure("archive")
		.route({
			summary:
				"Keeps a file of a run walked elsewhere: a transcript, a command log or checkpoints.",
		})
		.output(output(z.void()))
		.input(z.object({ ref: archiveRefSchema, content: z.string() }))
		.handler(({ context, input }) =>
			context.exchange.archivePut(context.deviceKey, input.ref, input.content),
		),
	/** A file of a run in a Space the Device's owner is in. Null when there is none. */
	get: deviceProcedure("archive")
		.route({
			summary: "Reads a file of a run in the archive. Null when there is none.",
		})
		.output(output(z.string().nullable()))
		.input(z.object({ ref: archiveRefSchema }))
		.handler(({ context, input }) =>
			context.exchange.archiveGet(context.deviceKey, input.ref),
		),
	/**
	 * A step's live transcript, for a Member of its run's Space: its
	 * entries after `afterSeq`, then each new one, until the step ends.
	 */
	follow: deviceProcedure("archive")
		.route({
			summary:
				"Streams the transcript of a step: what is saved first, then each new entry.",
		})
		.output(stream(transcriptEntryViewSchema))
		.input(
			z.object({
				step: feedStepSchema,
				afterSeq: z.number().int().min(0),
			}),
		)
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.archiveFollow(context.deviceKey, input, signal);
		}),
	/** The Walker's live entries of a step someone follows; `ended`: the step ended. */
	tail: deviceProcedure("archive")
		.route({
			summary:
				"Takes the live transcript entries of a step that someone follows.",
		})
		.output(output(z.void()))
		.input(
			z.object({
				step: feedStepSchema,
				entries: z.array(transcriptEntrySchema).max(1_000),
				ended: z.boolean(),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.archiveTail(context.deviceKey, {
				...input,
				entries: input.entries as TranscriptEntry[],
			}),
		),
};
