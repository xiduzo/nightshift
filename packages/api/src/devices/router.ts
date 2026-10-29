import { phoneSchema } from "@nightshift/devices";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output, stream } from "../output";
import { ownerProcedure, protectedProcedure, readable } from "../procedures";
import { phonesOf, removePhone } from "./phones";
import {
	devicesOverviewSchema,
	joinProgressSchema,
	leaveResultSchema,
	mergePendingSchema,
	mergePreviewSchema,
	mergeResultSchema,
	otherDeviceViewSchema,
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
const mergeInput = z
	.object({ join: z.array(z.string().min(1).max(64)).max(1_000).optional() })
	.default({});

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
	 * The owner's other Devices, as this computer knows them from their
	 * documents: their profiles and secret names, read-only. Change them
	 * on that Device.
	 */
	others: ownerProcedure
		.route({
			summary:
				"Lists your other devices with their profiles and secret names, read-only.",
		})
		.output(output(z.array(otherDeviceViewSchema)))
		.handler(({ context }) => context.devices.others(context.session.user.id)),
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
				context.access.headers,
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
			context.devices.approve(context.access.headers, input.userCode),
		),
	deny: protectedProcedure
		.route({ summary: "Denies a pairing code." })
		.output(output(z.void()))
		.input(z.object({ userCode: z.string().trim().min(1).max(32) }))
		.handler(({ context, input }) =>
			context.devices.deny(context.access.headers, input.userCode),
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
	 * The merge of this computer's Personal into its home Host's (ADR 1):
	 * one Space named "Personal", which the Host keeps. `join`: the
	 * projects to move into the project of a shared Space with their
	 * remote. Without it, they stay apart in Personal.
	 */
	merge: {
		/**
		 * A Device that joined before the merge existed, or a merge that
		 * stopped: Personal waits for the person to merge it.
		 */
		pending: ownerProcedure
			.route({
				summary:
					"Says whether this computer's Personal waits to merge into its home Host's.",
			})
			.output(output(mergePendingSchema))
			.handler(({ context }) => context.devices.mergePending()),
		preview: ownerProcedure
			.route({
				summary:
					"Shows what merging this computer's Personal into its home Host's does. Changes nothing.",
			})
			.input(mergeInput)
			.output(output(mergePreviewSchema))
			.handler(({ context, input }) => context.devices.mergePreview(input)),
		run: ownerProcedure
			.route({
				summary:
					"Merges this computer's Personal into its home Host's, after a copy of its data.",
			})
			.input(mergeInput)
			.output(output(mergeResultSchema))
			.handler(({ context, input }) => context.devices.merge(input)),
	},
	/**
	 * This computer leaves its home Host (`nightshift leave`, ADR 1): the
	 * Host removes its access, and Personal splits off the Host's with the
	 * projects this computer has and the runs it walked. The Host keeps
	 * everything.
	 */
	leave: ownerProcedure
		.route({
			summary:
				"Leaves this computer's home Host. This computer keeps a Personal of its own, after a copy of its data.",
		})
		.output(output(leaveResultSchema))
		.handler(({ context }) => context.devices.leave()),
	/**
	 * Pairs this computer with a Host (`nightshift join`): yields the code to
	 * approve there, then the Host once it is approved. After a home Host,
	 * this computer's Personal merges into the Host's, and it yields how.
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
