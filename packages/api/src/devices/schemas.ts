import {
	type DevicesOverview,
	type JoinProgress,
	type LeaveResult,
	type MergePending,
	type MergePreview,
	type MergeResult,
	type OfferView,
	type OtherDeviceView,
	offerCapsSchema,
	type PairingReviewView,
	type SpaceDeviceView,
} from "@nightshift/devices";

import { z } from "zod";

import { exact } from "../output";
import { runStatusSchema } from "../runs";

/**
 * The output schemas of Devices and Hosts, as a Person sees them: this
 * computer's Devices and Offers, and pairing. A paired Device's link and
 * the work relay are the Host's contract (`@nightshift/devices`).
 */

const hostRoleSchema = z.enum(["home", "guest"]);

const linkedHostSchema = z.object({
	hostId: z.string(),
	name: z.string(),
	role: hostRoleSchema,
	/** In the order Devices try them. */
	addresses: z.array(z.string()),
	/** The address that answers now. */
	address: z.string().nullable(),
	status: z.enum(["connecting", "online", "offline", "revoked"]),
	/** Epoch ms of the last change of `status`. */
	since: z.number(),
	fingerprint: z.string().nullable(),
	/** The Spaces it keeps for this computer. */
	spaces: z.array(
		z.object({ id: z.string(), name: z.string(), personal: z.boolean() }),
	),
});

const pairedDeviceSchema = z.object({
	id: z.string(),
	name: z.string(),
	platform: z.string(),
	/** The Person who approved the pairing. */
	ownerId: z.string(),
	/** The address the Device joined by, when this Host is its home Host. */
	homeHost: z.string().nullable(),
	lastSeenAt: z.number().nullable(),
	online: z.boolean(),
	pairedAt: z.number(),
	revokedAt: z.number().nullable(),
});

/** What the Devices page shows, for one Person. */
export const devicesOverviewSchema = exact<DevicesOverview>()(
	z.object({
		/** This computer, for its owner. Null for another Person. */
		thisComputer: z
			.object({
				id: z.string(),
				name: z.string(),
				platform: z.string(),
				keyStore: z.enum(["keychain", "file"]),
				host: z.object({
					enabled: z.boolean(),
					addresses: z.array(z.string()),
					reachable: z.enum(["this-computer", "network"]),
					restartNeeded: z.boolean(),
					fingerprint: z.string().nullable(),
				}),
				hosts: z.array(linkedHostSchema),
			})
			.nullable(),
		devices: z.array(pairedDeviceSchema),
	}),
);

/** A Device of a Space, as every Member sees it. */
export const spaceDeviceViewSchema = exact<SpaceDeviceView>()(
	z.object({
		id: z.string(),
		name: z.string(),
		/** Null when this computer cannot tell. */
		online: z.boolean().nullable(),
		thisDevice: z.boolean(),
		mine: z.boolean(),
		owner: z.string().nullable(),
		platform: z.string().nullable(),
		lastSeenAt: z.number().nullable(),
		clones: z.array(
			z.object({ projectId: z.string(), projectName: z.string() }),
		),
		offers: z.array(
			offerCapsSchema.extend({ profile: z.string(), profileName: z.string() }),
		),
	}),
);

/**
 * One of the owner's other Devices, from its document: its profiles and
 * the names of its secrets, never their values. Read-only here.
 */
export const otherDeviceViewSchema = exact<OtherDeviceView>()(
	z.object({
		id: z.string(),
		name: z.string(),
		/** Null when this computer cannot tell. */
		online: z.boolean().nullable(),
		platform: z.string().nullable(),
		profiles: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				kind: z.enum(["agent", "model"]),
			}),
		),
		secrets: z.array(
			z.object({ name: z.string(), setAt: z.number().nullable() }),
		),
		/** When the Device last looked at itself. */
		checkedAt: z.number().nullable(),
	}),
);

/** A pairing code, as the Person approving it sees it. */
export const pairingReviewViewSchema = exact<PairingReviewView>()(
	z.object({
		userCode: z.string(),
		hostAdmin: z.boolean(),
		home: z.boolean().nullable(),
		status: z.enum(["pending", "approved", "denied"]),
		device: z.object({
			id: z.string(),
			name: z.string().nullable(),
			platform: z.string().nullable(),
		}),
		fingerprint: z.string().nullable(),
	}),
);

/** What a merge of this computer's Personal into its home Host's would do. */
export const mergePreviewSchema = exact<MergePreview>()(
	z.object({
		host: z.object({ id: z.string(), name: z.string() }),
		projects: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				remote: z.string().nullable(),
				removed: z.boolean(),
				runs: z.number(),
				into: z.enum(["new", "same-remote", "shared", "apart"]),
				sharedSpace: z.object({ id: z.string(), name: z.string() }).nullable(),
				renamedFlows: z.array(z.object({ from: z.string(), to: z.string() })),
				schedules: z.number(),
			}),
		),
		runs: z.number(),
	}),
);

const mergeStateSchema = z.enum(["planned", "mapped", "moved", "pushed"]);

/** Whether this computer's Personal waits to merge into its home Host's. */
export const mergePendingSchema = exact<MergePending>()(
	z.object({
		pending: z.boolean(),
		state: mergeStateSchema.nullable(),
		hostName: z.string().nullable(),
		blocked: z.string().nullable(),
	}),
);

/** How a merge of Personal went. */
export const mergeResultSchema = exact<MergeResult>()(
	z.object({
		state: mergeStateSchema,
		projects: z.number(),
		runs: z.number(),
		backup: z.string(),
	}),
);

/** How `nightshift leave` went: the Host, and the split of Personal off its Personal. */
export const leaveResultSchema = exact<LeaveResult>()(
	z.object({
		host: z.object({ id: z.string(), name: z.string() }),
		told: z.boolean(),
		split: z
			.object({
				state: z.enum(["planned", "moved", "done"]),
				spaceId: z.string(),
				projects: z.number(),
				runs: z.number(),
				unpinned: z.number(),
				backup: z.string(),
			})
			.nullable(),
		waiting: z.string().nullable(),
	}),
);

/** How `nightshift join` goes, step by step. */
export const joinProgressSchema = exact<JoinProgress>()(
	z.discriminatedUnion("kind", [
		z.object({
			kind: z.literal("code"),
			userCode: z.string(),
			verificationUri: z.string().nullable(),
			verificationUriComplete: z.string().nullable(),
			fingerprint: z.string().nullable(),
			expiresAt: z.number(),
		}),
		z.object({
			kind: z.literal("joined"),
			hostId: z.string(),
			hostName: z.string(),
			role: hostRoleSchema,
			hostAdmin: z.boolean().nullable(),
		}),
		z.object({ kind: z.literal("merge-preview"), preview: mergePreviewSchema }),
		z.object({ kind: z.literal("merged"), result: mergeResultSchema }),
		z.object({ kind: z.literal("merge-skipped"), reason: z.string() }),
	]),
);

const twoFactorSchema = z.object({
	enabled: z.boolean(),
	required: z.boolean(),
	/** The Host refuses the session until it turns two-factor on. */
	setUpNeeded: z.boolean(),
	/** How many days a browser the person trusts skips the code at sign-in. */
	trustedBrowserDays: z.number().int().positive(),
});

/** How the session's Person signs in. */
export const accountStatusSchema = z.union([
	z.object({
		signedIn: z.boolean(),
		person: z.null(),
		thisComputer: z.boolean(),
		hasPassword: z.boolean(),
		twoFactor: twoFactorSchema,
	}),
	z.object({
		signedIn: z.boolean(),
		person: z.object({ name: z.string(), email: z.string() }),
		thisComputer: z.boolean(),
		hasPassword: z.boolean(),
		twoFactor: twoFactorSchema,
	}),
]);

/** One of this computer's Offers, and the runs it took. */
const offerViewSchema = exact<OfferView>()(
	offerCapsSchema.extend({
		spaceId: z.string(),
		spaceName: z.string(),
		/** The profile's id. */
		profile: z.string(),
		profileName: z.string(),
		offeredAt: z.number(),
		/** False: it was withdrawn in the Space. */
		listed: z.boolean(),
		/** The runs of other Persons on this computer in that Space, newest first. */
		runs: z.array(
			z.object({
				id: z.string(),
				title: z.string(),
				status: runStatusSchema,
				startedBy: z.string().nullable(),
				createdAt: z.number(),
			}),
		),
	}),
);

export const offerListSchema = z.object({
	offers: z.array(offerViewSchema),
	/**
	 * The Spaces this computer can offer to: shared ones, and on a Host the
	 * Personal of each Person whose home Host it is ("Personal of Ada").
	 */
	spaces: z.array(
		z.object({ id: z.string(), name: z.string(), personal: z.boolean() }),
	),
});
