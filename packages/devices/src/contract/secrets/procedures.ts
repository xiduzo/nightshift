import { secretNameSchema } from "@nightshift/flows";
import { z } from "zod";
import { described, sync } from "../procedure";
import {
	PERSONAL_SECRET_MAX,
	personalSecretNameSchema,
	projectRefSchema,
	projectSecretNameSchema,
	secretMoveSchema,
	spaceRefSchema,
	stepRunSchema,
	takenSecretSchema,
} from "./secrets";

/** The procedures of `hostContract.secrets`. */
export const personalSecretProcedures = {
	list: sync
		.route({
			summary:
				"Lists the names of the Personal secrets of a paired Device's Person, with when each was set.",
		})
		.output(described(z.array(personalSecretNameSchema))),
	values: sync
		.route({
			summary:
				"Gives a paired Device of the Person the values of these Personal secrets, for one use.",
		})
		.input(z.object({ names: z.array(secretNameSchema).max(200) }))
		.output(described(z.record(z.string(), z.string()))),
	set: sync
		.route({
			summary:
				"Saves a Personal secret of a paired Device's Person, or replaces its value.",
		})
		.input(
			z.object({
				name: secretNameSchema,
				value: z.string().min(1).max(PERSONAL_SECRET_MAX),
			}),
		)
		.output(described(z.void())),
	remove: sync
		.route({
			summary: "Removes a Personal secret of a paired Device's Person.",
		})
		.input(z.object({ name: secretNameSchema }))
		.output(described(z.void())),
	/**
	 * Asks another Device of the key's Person, paired here as its Home
	 * Host, to move a secret saved there (ADR 13, decision 7). That
	 * Device reads its own value and moves it: the value never passes
	 * through the Device that asks. Refused while that Device is offline,
	 * or when its version cannot do it.
	 */
	moveOnDevice: sync
		.route({
			summary:
				"Asks another Device of the Person to move a secret saved there to Personal, into a project, or to remove it.",
		})
		.input(
			z.object({
				deviceId: z.string().min(1).max(64),
				name: secretNameSchema,
				move: secretMoveSchema,
			}),
		)
		.output(described(z.void())),
};

/** The procedures of `hostContract.projectSecrets`. */
export const projectSecretProcedures = {
	list: sync
		.route({
			summary:
				"Lists the names of a project's secrets, with when and by whom each was set.",
		})
		.input(projectRefSchema)
		.output(described(z.array(projectSecretNameSchema))),
	values: sync
		.route({
			summary:
				"Gives a Device the values of its project's secrets for a step of the run placed on it now.",
		})
		.input(
			stepRunSchema.extend({
				/** Without: every value of the project, to take out of the step's output. */
				names: z.array(secretNameSchema).max(200).optional(),
			}),
		)
		.output(described(z.record(z.string(), z.string()))),
	set: sync
		.route({ summary: "Saves a project secret, or replaces its value." })
		.input(
			projectRefSchema.extend({
				name: secretNameSchema,
				value: z.string().min(1).max(PERSONAL_SECRET_MAX),
			}),
		)
		.output(described(z.void())),
	remove: sync
		.route({ summary: "Removes a project secret." })
		.input(projectRefSchema.extend({ name: secretNameSchema }))
		.output(described(z.void())),
	take: sync
		.route({
			summary:
				"Gives a Device the value of a project secret to move it to another scope.",
		})
		.input(projectRefSchema.extend({ name: secretNameSchema }))
		.output(described(takenSecretSchema)),
};

/** The procedures of `hostContract.spaceSecrets`. */
export const spaceSecretProcedures = {
	list: sync
		.route({
			summary:
				"Lists the names of a Space's secrets, with when and by whom each was set.",
		})
		.input(spaceRefSchema)
		.output(described(z.array(projectSecretNameSchema))),
	set: sync
		.route({ summary: "Saves a Space secret, or replaces its value." })
		.input(
			spaceRefSchema.extend({
				name: secretNameSchema,
				value: z.string().min(1).max(PERSONAL_SECRET_MAX),
			}),
		)
		.output(described(z.void())),
	remove: sync
		.route({ summary: "Removes a Space secret." })
		.input(spaceRefSchema.extend({ name: secretNameSchema }))
		.output(described(z.void())),
	take: sync
		.route({
			summary:
				"Gives a Device the value of a Space secret to move it to another scope.",
		})
		.input(spaceRefSchema.extend({ name: secretNameSchema }))
		.output(described(takenSecretSchema)),
};
