import { z } from "zod";

/** What a Device and its Host say over its Link, and how pairing goes. */

/** A Space as a Host lists it to a Device. */
const listedSpaceSchema = z.object({
	id: z.string(),
	name: z.string(),
	personal: z.boolean(),
	/** The role of the Device's owner there. */
	role: z.string(),
});
export type ListedSpace = z.infer<typeof listedSpaceSchema>;

/** The Host, as a Device knows it. */
const hostSchema = z.object({
	id: z.string(),
	name: z.string(),
	addresses: z.array(z.string()),
});

/** What a paired Device learns from its Host when its link answers. */
export const hostHelloSchema = z.object({
	host: hostSchema,
	deviceId: z.string(),
	personId: z.string(),
	/** The Spaces the Device's owner is a Member of on the Host, with their role there. */
	spaces: z.array(listedSpaceSchema),
});
export type HostHello = z.infer<typeof hostHelloSchema>;

/**
 * A phone signed in to a Host as its Person, as the Person sees it: the
 * Night Shift app with its notifications on. It runs nothing: it is not a
 * Device.
 */
export const phoneSchema = z.object({
	id: z.string(),
	name: z.string(),
	platform: z.string(),
	createdAt: z.number(),
	lastSeenAt: z.number().nullable(),
});
export type PhoneView = z.infer<typeof phoneSchema>;

/** The Host's answer to a joining Device's poll: its Device key once approved. */
export const pairingRedeemedSchema = z.union([
	z.object({ status: z.enum(["pending", "slow-down", "denied", "expired"]) }),
	z.object({
		status: z.literal("joined"),
		key: z.string(),
		personId: z.string(),
		host: hostSchema,
	}),
]);
export type PairingRedeemed = z.infer<typeof pairingRedeemedSchema>;

/** A pairing code for a joining Device, and where its Person approves it. */
export const pairingStartSchema = z.object({
	deviceCode: z.string(),
	userCode: z.string(),
	/** The page of the Host where the Person enters the code. */
	verificationUri: z.string(),
	/** The same page with the code filled in. */
	verificationUriComplete: z.string(),
	expiresIn: z.number(),
	interval: z.number(),
	/** The SHA-256 fingerprint of the certificate the Host serves itself, if any. */
	fingerprint: z.string().nullable(),
});
export type PairingStart = z.infer<typeof pairingStartSchema>;
