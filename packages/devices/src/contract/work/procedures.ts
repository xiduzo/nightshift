import { z } from "zod";
import { described, describedStream, relay } from "../procedure";
import { workDeliverySchema, workReplySchema, workRequestSchema } from "./work";

/** The procedures of `hostContract.devices`: the work relay. */
export const workProcedures = {
	/** The calls of the runs the Host walks on this Device, and their cancels, as they come. */
	work: relay
		.route({
			summary:
				"Streams the calls a Host sends to a placed Device, and their cancels.",
		})
		.input(
			z.object({
				/** The calls the Device still serves: any other it took has ended there. */
				running: z.array(z.string().min(1).max(64)).max(1_000),
			}),
		)
		.output(describedStream(workDeliverySchema)),
	/**
	 * The Walker → Host → Device leg: the stream carries the replies,
	 * and closing it cancels the call. With a `stopId`, `devices.stop`
	 * cancels it too.
	 */
	call: relay
		.route({
			summary:
				"Calls another of the Person's Devices through this Host and streams its replies.",
		})
		.input(
			z.object({
				deviceId: z.string().min(1).max(64),
				request: workRequestSchema,
				/** The Walker's own id for the call: what `devices.stop` names. */
				stopId: z.string().min(1).max(64).optional(),
			}),
		)
		.output(describedStream(workReplySchema)),
	/**
	 * A stop of a call a Walker made with a `stopId`: the Device cancels
	 * it, and its stream goes on until the Device ended it there, after
	 * its cleanup. `known` false: no such call is open here now, and the
	 * Walker closes the stream.
	 */
	stop: relay
		.route({
			summary:
				"Stops a call a Walker made through this Host. Its stream ends after the Device's cleanup.",
		})
		.input(z.object({ id: z.string().min(1).max(64) }))
		.output(described(z.object({ known: z.boolean() }))),
	/** Whether one of the key's Person's Devices (or this Host) takes work now. */
	reachable: relay
		.route({
			summary:
				"Says whether one of the Person's Devices, or this Host, takes work now.",
		})
		.input(z.object({ deviceId: z.string().min(1).max(64) }))
		.output(described(z.boolean())),
	/** The placed Device's answers to a call it took. */
	workReply: relay
		.route({
			summary: "Takes the answers of a placed Device to a call it took.",
		})
		.input(
			z.object({
				id: z.string().min(1).max(64),
				replies: z.array(workReplySchema).max(1_000),
				done: z.boolean(),
			}),
		)
		.output(described(z.object({ known: z.boolean() }))),
};
