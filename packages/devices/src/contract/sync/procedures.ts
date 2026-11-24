import {
	type OwnDevice,
	runCommandSchema,
	startRunInputSchema,
	startTestInputSchema,
} from "@nightshift/engine";
import { nameSchema, permissionModeSchema } from "@nightshift/flows";
import { z } from "zod";
import { offerCapsSchema, offerRefSchema } from "../offers";
import { personalMergeInputSchema, personalMergeSchema } from "../personal";
import {
	described,
	describedStream,
	deviceName,
	exact,
	machineFingerprintSchema,
	sync,
} from "../procedure";
import { answerCostsBatchSchema, answerCostsInputSchema } from "./answers";
import { runRowsSchema, syncCursorsSchema } from "./rows";
import {
	commandBatchSchema,
	pendingBatchSchema,
	syncBatchSchema,
} from "./sync";

/** The rendered name of a lease. */
const leaseName = z.string().min(1).max(500);

/** A Host's answer to a take: the run holds the lease, or another run does. */
const leaseAnswerSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("held") }),
	z.object({
		kind: z.literal("busy"),
		holder: z.object({
			runId: z.string(),
			runTitle: z.string(),
			walkerId: z.string(),
			since: z.number(),
		}),
	}),
]);

/** A run start, as a Device asks its Host for its Person: the Host walks it (ADR 17 says where its steps run). */
const runStartInput = startRunInputSchema.and(
	z.object({ spaceId: z.string().min(1) }),
);

/** A test run's start (ADR 27), as a Device asks its Host: a saved flow, with its pins as refs and its skips. */
const testStartInput = startTestInputSchema.extend({
	spaceId: z.string().min(1),
});

/** A person's action on a run another Device walks, as a Device sends it: the Command, with its run. */
const runCommandInput = runCommandSchema({ runId: z.string().min(1) });

/** One of the Person's Devices, with whether it is online and has a Clone. */
const ownDeviceSchema = exact<OwnDevice>()(
	z.object({
		deviceId: z.string(),
		name: z.string(),
		thisDevice: z.boolean(),
		offers: z.array(z.string()).optional(),
		dev: z.boolean().optional(),
		ownerName: z.string().optional(),
		online: z.boolean(),
		hasClone: z.boolean(),
		profiles: z
			.array(
				z.object({
					id: z.string(),
					name: z.string(),
					kind: z.enum(["agent", "model"]),
					permissionMode: permissionModeSchema.optional(),
				}),
			)
			.optional(),
	}),
);

/** The procedures of `hostContract.sync`. */
export const syncProcedures = {
	stream: sync
		.route({
			summary:
				"Streams the rows of other Walkers after a Device's cursors, then each new batch.",
		})
		.input(z.object({ cursors: syncCursorsSchema }))
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
			summary: "Takes a Walker's report that it applied a command, or why not.",
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
	 * the whole set, then again each time it changes. They never wait
	 * behind rows.
	 */
	commands: sync
		.route({
			summary:
				"Streams the Commands that wait for a Device, then the whole set each time it changes.",
		})
		.input(z.object({}).default({}))
		.output(describedStream(commandBatchSchema)),
	/**
	 * The Commands that wait for other Devices, in the Spaces of the
	 * key's Person: the whole set, then again each time it changes. The
	 * Device shows an action on its way until its Walker applies it.
	 */
	pending: sync
		.route({
			summary:
				"Streams the Commands that wait for other Devices in the Spaces of a Device's Person, then the whole set each time it changes.",
		})
		.input(z.object({}).default({}))
		.output(describedStream(pendingBatchSchema)),
	/** Starts a run placed on another Device, for the key's Person: this Host walks it. */
	startRun: sync
		.route({
			summary: "Starts a run placed on another Device. This Host walks it.",
		})
		.input(runStartInput)
		.output(described(z.object({ runId: z.string() }))),
	/**
	 * Starts a test run (ADR 27) placed on another Device, for the key's
	 * Person: this Host walks it, and reads the pinned outputs from its
	 * own log.
	 */
	startTest: sync
		.route({
			summary:
				"Starts a test run with pins and skips, placed on another Device. This Host walks it.",
		})
		.input(testStartInput)
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
				profileName: nameSchema,
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
	/**
	 * A Person on the Device adds a Project to a Space here, by its
	 * remote: this Host defines it and copies it from GitHub. The
	 * Project of that remote comes back when the Space has one.
	 */
	addProject: sync
		.route({
			summary:
				"Adds a project to a Space here for a paired Device, by its GitHub repository.",
		})
		.input(
			z.object({
				spaceId: z.string().min(1),
				name: z.string().trim().min(1).max(200),
				/** Normalised: `github.com/acme/app`. */
				remote: z
					.string()
					.min(3)
					.max(300)
					.regex(/^[^\s/:@]+\/\S+$/),
			}),
		)
		.output(described(z.object({ projectId: z.string() }))),
	/**
	 * A Person on the Device adds a Project without a folder to a Space
	 * here (ADR 22): this Host defines it. Each call adds another
	 * Project.
	 */
	addWithoutFolder: sync
		.route({
			summary:
				"Adds a project without a folder to a Space here for a paired Device.",
		})
		.input(
			z.object({
				spaceId: z.string().min(1),
				name: z.string().trim().min(1).max(200),
			}),
		)
		.output(described(z.object({ projectId: z.string() }))),
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
	 * The Device's Clones in a Space here are exactly these Projects: a
	 * Clone the Host missed is added, one the Device no longer has goes.
	 * The Device says it each time its link comes online; saying it again
	 * changes nothing.
	 */
	setClones: sync
		.route({
			summary:
				"Sets the Clones a paired Device has of the projects of a Space here.",
		})
		.input(
			z.object({
				spaceId: z.string().min(1),
				projectIds: z.array(z.string().min(1)).max(1000),
				deviceName,
				/** It is a development install (ADR 17). */
				dev: z.boolean(),
				/** The fingerprint of its computer (ADR 20). Only to a home Host. */
				machine: machineFingerprintSchema.optional(),
			}),
		)
		.output(
			described(
				z.object({
					added: z.array(z.string()),
					removed: z.array(z.string()),
				}),
			),
		),
	/**
	 * Takes the Projects of a home Device's own personal Space into the
	 * key's Person's personal Space here (ADR 1): each by its remote, a
	 * Project here with the same remote takes its place. Runs again
	 * with the same answer. `dryRun` changes nothing.
	 */
	mergePersonal: sync
		.route({
			summary:
				"Takes the projects of a home Device's personal Space into the Person's personal Space here.",
		})
		.input(personalMergeInputSchema)
		.output(described(personalMergeSchema)),
	/**
	 * What the answers of Night Shift's own agents cost in the Spaces
	 * this Host keeps: the Device gives its own rows the Host lacks, and
	 * gets the rows of its Person's Spaces after its cursors. A row is
	 * one answer by its key, so a call that comes again changes nothing.
	 */
	answerCosts: sync
		.route({
			summary:
				"Takes what a paired Device's answers of Night Shift's agents cost, and gives it the costs of its Spaces after its cursors.",
		})
		.input(answerCostsInputSchema)
		.output(described(answerCostsBatchSchema)),
};

/** The procedures of `hostContract.leases`. */
export const leaseProcedures = {
	/** Takes a lease for a run the key's Device walks, unless another run holds it. */
	take: sync
		.route({
			summary:
				"Takes a lease of a Space here for a run the Device walks, unless another run holds it.",
		})
		.input(
			z.object({
				spaceId: z.string().min(1),
				name: leaseName,
				runId: z.string().min(1).max(128),
				runTitle: z.string().max(500),
				ttlMs: z.number().int().positive(),
			}),
		)
		.output(described(leaseAnswerSchema)),
	/** Renews the leases of a run the key's Device walks. Answers the names it no longer holds. */
	renew: sync
		.route({
			summary:
				"Renews the leases of a run the Device walks, and names those it no longer holds.",
		})
		.input(
			z.object({
				spaceId: z.string().min(1),
				runId: z.string().min(1).max(128),
				names: z.array(leaseName).max(100),
			}),
		)
		.output(described(z.array(z.string()))),
	/** Lets go of the leases of a run the key's Device walks: by name, or all. */
	release: sync
		.route({
			summary:
				"Lets go of the leases of a run the Device walks, by name or all of them.",
		})
		.input(
			z.object({
				spaceId: z.string().min(1),
				runId: z.string().min(1).max(128),
				names: z.array(leaseName).max(100).optional(),
			}),
		)
		.output(described(z.void())),
};
