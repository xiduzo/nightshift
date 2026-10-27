import { phoneSchema } from "@nightshift/devices";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output, stream } from "../output";
import { ownerProcedure, protectedProcedure, readable } from "../procedures";
import { phonesOf, removePhone } from "./phones";
import {
	devicesOverviewSchema,
	joinProgressSchema,
	pairingReviewViewSchema,
	spaceDeviceViewSchema,
} from "./schemas";

/**
 * Devices: this computer's own (its Hosts, "Be a Host"), and on a Host the
 * Person's paired Devices. A Person sees and removes their own Devices
 * only; approving a code binds it to the Person who entered it. The work
 * relay that a paired Device calls under `devices` is the Host's router
 * (`hostPeer`).
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
			context.devices.review(
				context.headers,
				input.userCode,
				context.session.user.id,
			),
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
	 * Your phones on the Host of the session's Space: this computer's own
	 * when it keeps the Space, else the Host's, asked over this computer's
	 * link. The link is its owner's: another Person gets none through it.
	 */
	phones: protectedProcedure
		.route({ summary: "Lists your phones on the Host of the Space." })
		.output(output(z.array(phoneSchema)))
		.handler(async ({ context }) => {
			const personId = context.session.user.id;
			const hostId = context.spaceId
				? await context.devices.hostOf(context.spaceId)
				: null;
			if (hostId === null) return phonesOf(context.notifications, personId);
			return personId === context.daemon.device.ownerId
				? context.devices.phonesAt(hostId)
				: [];
		}),
	/** Signs out one of your phones on the Host of the session's Space. */
	removePhone: protectedProcedure
		.route({
			summary: "Signs out one of your phones on the Host of the Space.",
		})
		.output(output(z.void()))
		.input(z.object({ id: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			const personId = context.session.user.id;
			const hostId = context.spaceId
				? await context.devices.hostOf(context.spaceId)
				: null;
			if (hostId === null) {
				return removePhone(context.notifications, personId, input.id);
			}
			if (personId !== context.daemon.device.ownerId) {
				throw new ORPCError("FORBIDDEN", {
					message: "Only the owner of this computer can do this here.",
				});
			}
			await context.devices.removePhoneAt(hostId, input.id);
		}),
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
		.handler(async function* ({ context, input, signal, path }) {
			try {
				yield* context.devices.join(input, signal);
			} catch (error) {
				throw readable(error, path);
			}
		}),
};
