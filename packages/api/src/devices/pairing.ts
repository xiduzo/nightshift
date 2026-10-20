import { z } from "zod";

import { deviceProcedure, publicProcedure } from "../procedures";

const deviceId = z.string().regex(/^[\w-]{1,64}$/);

/**
 * Pairing, as a joining Device calls it before it has a key. Public: the
 * device authorization flow is the check (a Person approves the code).
 */
export const pairing = {
	start: publicProcedure
		.input(
			z.object({
				deviceId,
				name: z.string().trim().min(1).max(64),
				platform: z.string().trim().min(1).max(32),
			}),
		)
		.handler(({ context, input }) => context.devices.startPairing(input)),
	redeem: publicProcedure
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
	hello: deviceProcedure("sync").handler(({ context }) =>
		context.devices.hello(context.deviceKey),
	),
	/** Every few seconds: the Device is online while these answer. */
	heartbeat: deviceProcedure("sync").handler(({ context }) =>
		context.devices.hello(context.deviceKey),
	),
};
