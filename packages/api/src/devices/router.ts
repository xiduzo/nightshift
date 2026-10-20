import {
	type WorkRequest,
	workReplySchema,
	workRequestSchema,
} from "@nightshift/engine";
import { z } from "zod";

import {
	deviceProcedure,
	ownerProcedure,
	protectedProcedure,
	readable,
} from "../procedures";

/**
 * Devices: this computer's own (its Hosts, "Be a Host"), and on a Host the
 * Person's paired Devices. A Person sees and removes their own Devices
 * only; approving a code binds it to the Person who entered it.
 */
export const devices = {
	list: protectedProcedure.handler(({ context }) =>
		context.devices.overview({
			personId: context.session.user.id,
			owner: context.session.user.id === context.daemon.device.ownerId,
		}),
	),
	/**
	 * The Devices of the session's Space, as every Member sees them: name,
	 * online, Clones of its Projects, offered profiles. Nothing else.
	 */
	space: protectedProcedure.handler(({ context }) =>
		context.offers.spaceDevices(context.spaceId),
	),
	/** Shows the device that waits with this code, and holds the code for the Person. */
	review: protectedProcedure
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.review(context.headers, input.userCode),
		),
	approve: protectedProcedure
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.approve(context.headers, input.userCode),
		),
	deny: protectedProcedure
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.deny(context.headers, input.userCode),
		),
	/** Removes a Device's access to this computer. */
	revoke: protectedProcedure
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
		.input(z.object({ deviceId: z.string().min(1).max(64) }))
		.handler(({ context, input }) =>
			context.exchange.reachable(context.deviceKey, input.deviceId),
		),
	/** The placed Device's answers to a call it took. */
	workReply: deviceProcedure("relay")
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
