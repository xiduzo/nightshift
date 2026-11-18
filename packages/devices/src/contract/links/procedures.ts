import { z } from "zod";
import {
	described,
	deviceId,
	deviceName,
	machineFingerprintSchema,
	procedure,
	sync,
} from "../procedure";
import {
	hostHelloSchema,
	pairingRedeemedSchema,
	pairingStartSchema,
	phoneSchema,
} from "./links";

/** The procedures of `hostContract.link`. */
export const linkProcedures = {
	hello: sync
		.route({
			summary:
				"Opens a paired Device's link: who the Host is and its addresses now.",
		})
		.output(described(hostHelloSchema)),
	heartbeat: sync
		.route({
			summary: "Keeps a paired Device online, with the Host's facts now.",
		})
		.output(described(hostHelloSchema)),
	/** The phones of the key's Person here, for the Devices page of their computer. */
	phones: sync
		.route({
			summary: "Lists the phones of a paired Device's Person on this Host.",
		})
		.output(described(z.array(phoneSchema))),
	/** Signs out one of them, from their computer. */
	removePhone: sync
		.route({
			summary: "Signs out one phone of a paired Device's Person on this Host.",
		})
		.errors({ NOT_FOUND: { status: 404 } })
		.input(z.object({ id: z.string().min(1) }))
		.output(described(z.void())),
	/**
	 * The Device leaves this Host (`nightshift leave`): its access here
	 * ends, as when its owner removes it. An older Host has none: the
	 * Device leaves on its own, and the Host still lists it.
	 */
	leave: sync
		.route({
			summary:
				"Removes a paired Device's own access here: it leaves this Host.",
		})
		.output(described(z.void())),
};

/** The procedures of `hostContract.pairing`. */
export const pairingProcedures = {
	start: procedure
		.route({
			summary:
				"Gives a joining Device a pairing code for its Person to approve.",
		})
		.input(
			z.object({
				deviceId,
				name: deviceName,
				platform: z.string().trim().min(1).max(32),
				/** The fingerprint of its computer (ADR 20). Only to a home Host. */
				machine: machineFingerprintSchema.optional(),
				/** The Device asks this Host to be its home Host. An older Device leaves it out. */
				home: z.boolean().optional(),
			}),
		)
		.output(described(pairingStartSchema)),
	redeem: procedure
		.route({
			summary:
				"Answers a joining Device's poll, with its Device key once the code is approved.",
		})
		.input(
			z.object({
				deviceCode: z.string().min(1).max(256),
				deviceId,
				/** This Host is to be the Device's home Host. */
				home: z.boolean(),
				/** The address the Device joined by. */
				address: z.string().url().max(512),
			}),
		)
		.output(described(pairingRedeemedSchema)),
};
