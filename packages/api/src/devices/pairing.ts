import { z } from "zod";

import { output } from "../output";
import { deviceProcedure, publicProcedure } from "../procedures";
import { phonesOf, removePhone } from "./phones";
import {
	hostHelloSchema,
	pairingRedeemedSchema,
	pairingStartSchema,
	phoneSchema,
} from "./schemas";

const deviceId = z.string().regex(/^[\w-]{1,64}$/);

/**
 * Pairing, as a joining Device calls it before it has a key. Public: the
 * device authorization flow is the check (a Person approves the code).
 */
export const pairing = {
	start: publicProcedure
		.route({
			summary:
				"Gives a joining Device a pairing code for its Person to approve.",
		})
		.output(output(pairingStartSchema))
		.input(
			z.object({
				deviceId,
				name: z.string().trim().min(1).max(64),
				platform: z.string().trim().min(1).max(32),
			}),
		)
		.handler(({ context, input }) => context.devices.startPairing(input)),
	redeem: publicProcedure
		.route({
			summary:
				"Answers a joining Device's poll, with its Device key once the code is approved.",
		})
		.output(output(pairingRedeemedSchema))
		.input(
			z.object({
				deviceCode: z.string().min(1).max(256),
				deviceId,
				home: z.boolean(),
				address: z.string().url().max(512),
			}),
		)
		.handler(({ context, input }) => context.devices.redeemPairing(input)),
};

/** A paired Device's link to this Host: with its Device key. */
export const link = {
	/** The first call on a link: who the Host is, and its addresses now. */
	hello: deviceProcedure("sync")
		.route({
			summary:
				"Opens a paired Device's link: who the Host is and its addresses now.",
		})
		.output(output(hostHelloSchema))
		.handler(({ context }) => context.devices.hello(context.deviceKey)),
	/** Every few seconds: the Device is online while these answer. */
	heartbeat: deviceProcedure("sync")
		.route({
			summary: "Keeps a paired Device online, with the Host's facts now.",
		})
		.output(output(hostHelloSchema))
		.handler(({ context }) => context.devices.hello(context.deviceKey)),
	/** The phones of the key's Person here, for the Devices page of their computer. */
	phones: deviceProcedure("sync")
		.route({
			summary: "Lists the phones of a paired Device's Person on this Host.",
		})
		.output(output(z.array(phoneSchema)))
		.handler(({ context }) =>
			phonesOf(context.notifications, context.deviceKey.personId),
		),
	/** Signs out one of them, from their computer. */
	removePhone: deviceProcedure("sync")
		.route({
			summary: "Signs out one phone of a paired Device's Person on this Host.",
		})
		.output(output(z.void()))
		.input(z.object({ id: z.string().min(1) }))
		.handler(({ context, input }) =>
			removePhone(context.notifications, context.deviceKey.personId, input.id),
		),
};
