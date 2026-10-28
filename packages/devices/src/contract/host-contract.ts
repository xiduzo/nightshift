import type { DeviceKeyPermission } from "@nightshift/auth";
import {
	type OwnDevice,
	startRunInputSchema,
	type TranscriptEntry,
} from "@nightshift/engine";
import { labelSchema, nameSchema } from "@nightshift/flows";
import type { RefusalKind } from "@nightshift/refusal";
import { type ContractRouterClient, oc } from "@orpc/contract";
import { z } from "zod";
import { archiveRefSchema, copyStampSchema } from "./archive";
import { described, describedStream, exact } from "./described";
import {
	hostHelloSchema,
	pairingRedeemedSchema,
	pairingStartSchema,
	phoneSchema,
} from "./links";
import { offerCapsSchema, offerRefSchema } from "./offers";
import { personalMergeInputSchema, personalMergeSchema } from "./personal";
import { runRowsSchema, syncCursorsSchema } from "./rows";
import {
	commandBatchSchema,
	feedStepSchema,
	syncBatchSchema,
	transcriptEntrySchema,
} from "./sync";
import { workDeliverySchema, workReplySchema, workRequestSchema } from "./work";

/**
 * The peer protocol: the procedures of a Host that a Device calls, written
 * once as an oRPC contract. Each procedure has its input and output
 * schemas, the Device key permission it needs, and its refusals.
 *
 * - The Host serves it: `hostRouter` (`host/router.ts`) implements it, and
 *   the API mounts that router at these paths (`/rpc/sync/push`).
 * - A Device calls it: `HostClient` is its client, over HTTPS
 *   (`links/host-client.ts`), or in memory on the same router in tests
 *   (`inMemoryHost`).
 *
 * The paths and the shapes are the wire format between daemons of
 * different versions: a Host from main serves Devices of older builds.
 * A change keeps what an older Device sends valid, and what it reads there.
 */

/** What a procedure asks of its caller. `key`: the permission its Device key needs. None: a joining Device, before it has a key. */
export type HostProcedureMeta = { key?: DeviceKeyPermission };

/**
 * The refusal of a Host that is not one now: "Be a Host" is off. Not an
 * UNAUTHORIZED: the Device keeps its key and tries again later.
 */
export const NOT_A_HOST =
	"This computer does not accept devices. Turn on Be a Host on its Devices page.";

/**
 * The kind of a refusal a Host sends as a BAD_REQUEST (`Refusal.kind`).
 * An older Device reads only the code and the words, and ignores it. An
 * older Host sends none: the Device reads its refusal as `invalid`.
 */
export const refusalDataSchema = exact<{ kind: RefusalKind }>()(
	z.object({
		kind: z.enum([
			"invalid",
			"signed-out",
			"forbidden",
			"not-found",
			"conflict",
			"unavailable",
		]),
	}),
);

/**
 * How a Host refuses a call. UNAUTHORIZED: the Device has no access here
 * (pair it again). FORBIDDEN: it may not do this. CONFLICT: not yet, try
 * again later. BAD_REQUEST: a refusal written for people, with its kind
 * (`refusalDataSchema`). HOST_UNREACHABLE: the Host of a Space this Host
 * does not keep cannot be reached now.
 */
const procedure = oc.$meta<HostProcedureMeta>({}).errors({
	UNAUTHORIZED: { status: 401 },
	FORBIDDEN: { status: 403 },
	CONFLICT: { status: 409 },
	BAD_REQUEST: { status: 400, data: refusalDataSchema.optional() },
	HOST_UNREACHABLE: { status: 503 },
});
/** A paired Device's link and the exchange of run history. */
const sync = procedure.meta({ key: "sync" });
/** The archive and live transcripts. */
const archive = procedure.meta({ key: "archive" });
/** The work relay. */
const relay = procedure.meta({ key: "relay" });

/** Ids that become Device ids on the Host. */
const deviceId = z.string().regex(/^[\w-]{1,64}$/);
const deviceName = z.string().trim().min(1).max(64);

/** A run start, as a Device asks its Host for its Person: the Host walks it, its steps on `deviceId`. */
const runStartInput = startRunInputSchema.and(
	z.object({
		spaceId: z.string().min(1),
		deviceId: z.string().min(1).max(64),
	}),
);

/** A person's action on a run another Device walks, as a Device sends it. */
const runCommandInput = z.discriminatedUnion("kind", [
	z.object({
		runId: z.string().min(1),
		kind: z.literal("gate.resolve"),
		payload: z.object({
			stepId: z.string().min(1),
			choice: z.string().min(1),
			note: z.string().optional(),
		}),
	}),
	z.object({
		runId: z.string().min(1),
		kind: z.literal("signal.send"),
		payload: z.object({ name: labelSchema }),
	}),
	z.object({
		runId: z.string().min(1),
		kind: z.literal("run.stop"),
		payload: z.object({
			when: z.enum(["now", "after-step", "cancel-after-step"]).optional(),
		}),
	}),
	z.object({
		runId: z.string().min(1),
		kind: z.literal("run.move"),
		payload: z.object({ to: z.string().min(1).max(64) }),
	}),
]);

/** One of the Person's Devices, with whether it is online and has a Clone. */
const ownDeviceSchema = exact<OwnDevice>()(
	z.object({
		deviceId: z.string(),
		name: z.string(),
		thisDevice: z.boolean(),
		offers: z.array(z.string()).optional(),
		online: z.boolean(),
		hasClone: z.boolean(),
		profiles: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					kind: z.enum(["agent", "model"]),
				}),
			)
			.optional(),
	}),
);

export const hostContract = {
	/** A paired Device's link: who the Host is, and the Device online while it answers. */
	link: {
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
				summary:
					"Signs out one phone of a paired Device's Person on this Host.",
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
	},
	/**
	 * Pairing, as a joining Device calls it before it has a key. No key:
	 * the device authorization flow is the check (a Person approves the
	 * code on the Host).
	 */
	pairing: {
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
	},
	/**
	 * The event log exchange: run history in and out by cursor, live, the
	 * commands for the runs the Device walks, and what it asks of the
	 * Host's Spaces. The Host filters every call by the membership of the
	 * key's Person.
	 */
	sync: {
		pull: sync
			.route({
				summary:
					"Gives a paired Device the rows of other Walkers after its cursors, and its commands.",
			})
			.input(z.object({ cursors: syncCursorsSchema }))
			.output(described(syncBatchSchema)),
		stream: sync
			.route({
				summary:
					"Streams the rows of other Walkers after a Device's cursors, then each new batch.",
			})
			.input(
				z.object({
					cursors: syncCursorsSchema,
					// False: the Device takes its Commands from `sync.commands`, so
					// they never wait behind rows. An older Device sends none.
					commands: z.boolean().optional(),
				}),
			)
			.output(describedStream(syncBatchSchema)),
		/** The Device's own rows: runs it walks, in Spaces its owner is in. */
		push: sync
			.route({ summary: "Takes the rows of the runs a paired Device walks." })
			.input(runRowsSchema)
			.output(described(z.object({ events: z.number() }))),
		/** A person's action on a run walked elsewhere, in the name of the key's Person. */
		command: sync
			.route({
				summary:
					"Sends a person's action on a run walked elsewhere to its Walker.",
			})
			.input(runCommandInput)
			.output(described(z.void())),
		/** The Walker applied a command, or says why not. */
		commandDone: sync
			.route({
				summary:
					"Takes a Walker's report that it applied a command, or why not.",
			})
			.input(
				z.object({
					id: z.string().min(1),
					error: z.string().max(2_000).nullable(),
				}),
			)
			.output(described(z.void())),
		/**
		 * The Commands for the runs the Device walks, on their own stream:
		 * the whole set, then again each time it changes. An older Host has
		 * none: its Commands come with the rows.
		 */
		commands: sync
			.route({
				summary:
					"Streams the Commands that wait for a Device, then the whole set each time it changes.",
			})
			.input(z.object({}).default({}))
			.output(describedStream(commandBatchSchema)),
		/** Starts a run placed on another Device, for the key's Person: this Host walks it. */
		startRun: sync
			.route({
				summary: "Starts a run placed on another Device. This Host walks it.",
			})
			.input(runStartInput)
			.output(described(z.object({ runId: z.string() }))),
		/** The key's Person's Devices for a project: online, with a Clone or not. */
		devices: sync
			.route({
				summary:
					"Lists the Person's Devices for a project: online or not, with a Clone or not.",
			})
			.input(z.object({ spaceId: z.string().min(1), projectId: z.string() }))
			.output(described(z.array(ownDeviceSchema))),
		/** The Device offers one of its profiles to a Space here (or changes its caps). */
		offer: sync
			.route({
				summary:
					"Publishes a paired Device's Offer of a profile to a Space here, or its new caps.",
			})
			.input(
				offerRefSchema.extend({
					...offerCapsSchema.shape,
					deviceName,
					// Optional: a Device from before profile ids sends none.
					profileName: nameSchema.optional(),
				}),
			)
			.output(described(z.void())),
		/** The Device withdraws its Offer from a Space here. */
		withdrawOffer: sync
			.route({
				summary: "Withdraws a paired Device's Offer from a Space here.",
			})
			.input(offerRefSchema)
			.output(described(z.void())),
		/** The Device has a Clone of a Project of a Space here. */
		addClone: sync
			.route({
				summary:
					"Records that a paired Device has a Clone of a project of a Space here.",
			})
			.input(
				z.object({
					spaceId: z.string().min(1),
					projectId: z.string().min(1),
					deviceName,
				}),
			)
			.output(described(z.void())),
		/**
		 * Takes the Projects of a home Device's own personal Space into the
		 * key's Person's personal Space here (ADR 1): each by its remote, a
		 * Project here with the same remote takes its place. Runs again
		 * with the same answer. `dryRun` changes nothing. An older Host has
		 * none: the Device keeps its own personal Space.
		 */
		mergePersonal: sync
			.route({
				summary:
					"Takes the projects of a home Device's personal Space into the Person's personal Space here.",
			})
			.input(personalMergeInputSchema)
			.output(described(personalMergeSchema)),
	},
	/** The archive: the run state of runs walked elsewhere, per Space, and live transcripts. */
	archive: {
		/** The Walker keeps a step's transcript or command log, or its run's checkpoints, here. */
		put: archive
			.route({
				summary:
					"Keeps a file of a run walked elsewhere: a transcript, a command log or checkpoints.",
			})
			.input(
				z.object({
					ref: archiveRefSchema,
					content: z.string(),
					// Which end of its step the copy holds. A Walker of an older version sends none.
					stamp: copyStampSchema.optional(),
				}),
			)
			.output(described(z.void())),
		/** A file of a run in a Space the Device's owner is in. Null when there is none. */
		get: archive
			.route({
				summary:
					"Reads a file of a run in the archive. Null when there is none.",
			})
			.input(z.object({ ref: archiveRefSchema }))
			.output(described(z.string().nullable())),
		/**
		 * A step's live transcript, for a Member of its run's Space: its
		 * entries after `afterSeq`, then each new one, until the step ends.
		 */
		follow: archive
			.route({
				summary:
					"Streams the transcript of a step: what is saved first, then each new entry.",
			})
			.input(
				z.object({ step: feedStepSchema, afterSeq: z.number().int().min(0) }),
			)
			.output(
				describedStream<typeof transcriptEntrySchema, TranscriptEntry>(
					transcriptEntrySchema,
				),
			),
		/** The Walker's live entries of a step someone follows; `ended`: the step ended. */
		tail: archive
			.route({
				summary:
					"Takes the live transcript entries of a step that someone follows.",
			})
			.input(
				z.object({
					step: feedStepSchema,
					entries: z.array(transcriptEntrySchema).max(1_000),
					ended: z.boolean(),
				}),
			)
			.output(described(z.void())),
	},
	/**
	 * The work relay: a placed Device takes the calls of the runs the Host
	 * walks on it, and a Walker calls another of its Person's Devices
	 * through the Host. The Host never dials a Device.
	 */
	devices: {
		/** The calls of the runs the Host walks on this Device, and their cancels, as they come. */
		work: relay
			.route({
				summary:
					"Streams the calls a Host sends to a placed Device, and their cancels.",
			})
			.input(
				z
					.object({
						/** The calls the Device still serves: any other it took has ended there. */
						running: z.array(z.string().min(1).max(64)).max(1_000),
					})
					.default({ running: [] }),
			)
			.output(describedStream(workDeliverySchema)),
		/**
		 * The Walker → Host → Device leg: the stream carries the replies,
		 * and closing it cancels the call.
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
				}),
			)
			.output(describedStream(workReplySchema)),
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
	},
};

/** The procedures of a Host as a Device calls them: the client of `hostContract`. */
export type HostClient = ContractRouterClient<typeof hostContract>;
