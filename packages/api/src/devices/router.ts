import {
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "@nightshift/devices";

import { z } from "zod";

import { output, stream } from "../output";
import {
	deviceProcedure,
	ownerProcedure,
	protectedProcedure,
	readable,
} from "../procedures";
import {
	devicesOverviewSchema,
	joinProgressSchema,
	pairingReviewViewSchema,
	spaceDeviceViewSchema,
	workDeliverySchema,
	workReplyViewSchema,
} from "./schemas";

/**
 * Devices: this computer's own (its Hosts, "Be a Host"), and on a Host the
 * Person's paired Devices. A Person sees and removes their own Devices
 * only; approving a code binds it to the Person who entered it.
 */
export const devices = {
	list: protectedProcedure
		.route({
			summary:
				"Lists this computer's Hosts, and on a Host the Person's paired Devices.",
		})
		.output(output(devicesOverviewSchema))
		.handler(({ context }) =>
			context.devices.overview({
				personId: context.session.user.id,
				owner: context.session.user.id === context.daemon.device.ownerId,
			}),
		),
	/**
	 * The Devices of the session's Space, as every Member sees them: name,
	 * online, Clones of its Projects, offered profiles. Nothing else.
	 */
	space: protectedProcedure
		.route({
			summary:
				"Lists the Devices of the Space as every Member sees them: online, Clones and Offers.",
		})
		.output(output(z.array(spaceDeviceViewSchema)))
		.handler(({ context }) =>
			context.offers.spaceDevices(context.spaceId, context.session.user.id),
		),
	/** Shows the device that waits with this code, and holds the code for the Person. */
	review: protectedProcedure
		.route({
			summary:
				"Shows the Device that waits with a pairing code, and holds the code for the Person.",
		})
		.output(output(pairingReviewViewSchema))
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.review(context.headers, input.userCode),
		),
	approve: protectedProcedure
		.route({
			summary: "Approves a pairing code: the Device joins as the Person's.",
		})
		.output(output(z.void()))
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.approve(context.headers, input.userCode),
		),
	deny: protectedProcedure
		.route({ summary: "Denies a pairing code." })
		.output(output(z.void()))
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.deny(context.headers, input.userCode),
		),
	/** Removes a Device's access to this computer. */
	revoke: protectedProcedure
		.route({
			summary:
				"Removes the access of one of the Person's Devices to this computer.",
		})
		.output(output(z.void()))
		.input(z.object({ deviceId: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.devices.revoke(context.session.user.id, input.deviceId),
		),
	/**
	 * The relay's work half, as a placed Device calls it on its Host with
	 * its Device key: the calls of the runs the Host walks on this Device,
	 * as they come. The Host never dials a Device.
	 */
	work: deviceProcedure("relay")
		.route({
			summary:
				"Streams the calls a Host sends to a placed Device, and their cancels.",
		})
		.output(stream(workDeliverySchema))
		.input(
			z
				.object({
					/** The calls the Device still serves: any other it took has ended there. */
					running: z.array(z.string().min(1).max(64)).max(1_000),
				})
				.default({ running: [] }),
		)
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.work(context.deviceKey, input, signal);
		}),
	/**
	 * The Walker → Host → Device leg: a Device that walks a run calls
	 * another of its Person's Devices (or this Host) through here; the
	 * stream carries the replies, and closing it cancels the call.
	 */
	call: deviceProcedure("relay")
		.route({
			summary:
				"Calls another of the Person's Devices through this Host and streams its replies.",
		})
		.output(stream(workReplyViewSchema))
		.input(
			z.object({
				deviceId: z.string().min(1).max(64),
				request: workRequestSchema,
			}),
		)
		.handler(async function* ({ context, input, signal }) {
			yield* context.exchange.call(
				context.deviceKey,
				{
					deviceId: input.deviceId,
					request: input.request as unknown as WorkRequest,
				},
				signal,
			);
		}),
	/** Whether one of the key's Person's Devices (or this Host) takes work now. */
	reachable: deviceProcedure("relay")
		.route({
			summary:
				"Says whether one of the Person's Devices, or this Host, takes work now.",
		})
		.output(output(z.boolean()))
		.input(z.object({ deviceId: z.string().min(1).max(64) }))
		.handler(({ context, input }) =>
			context.exchange.reachable(context.deviceKey, input.deviceId),
		),
	/** The placed Device's answers to a call it took. */
	workReply: deviceProcedure("relay")
		.route({
			summary: "Takes the answers of a placed Device to a call it took.",
		})
		.output(output(z.object({ known: z.boolean() })))
		.input(
			z.object({
				id: z.string().min(1).max(64),
				replies: z.array(workReplySchema).max(1_000),
				done: z.boolean(),
			}),
		)
		.handler(({ context, input }) =>
			context.exchange.workReply(context.deviceKey, input),
		),
	/**
	 * Pairs this computer with a Host (`nightshift join`): yields the code to
	 * approve there, then the Host once it is approved.
	 */
	join: ownerProcedure
		.route({
			summary:
				"Pairs this computer with a Host: streams the code to approve, then the Host.",
		})
		.output(stream(joinProgressSchema))
		.input(
			z.object({
				url: z.string().trim().min(1),
				role: z.enum(["home", "guest"]).default("home"),
			}),
		)
		.handler(async function* ({ context, input, signal }) {
			try {
				yield* context.devices.join(input, signal);
			} catch (error) {
				throw readable(error);
			}
		}),
};
