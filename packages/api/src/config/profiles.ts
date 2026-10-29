import { profileUseKey, saveProfile } from "@nightshift/engine";
import { agentProfileSchema, modelProfileSchema } from "@nightshift/flows";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output } from "../output";
import { ownerProcedure, protectedProcedure } from "../procedures";
import {
	profileCatalogSchema,
	profileListSchema,
	profileViewSchema,
} from "./schemas";

/** The profile an edit changes; a new profile has none. */
const edited = { id: z.string().min(1).optional() };

/**
 * Profiles: an Agent Profile (a harness, a model and its tools) for Agent
 * nodes, or a Model Profile (a decider and its model) for Decisions and
 * Values decided by a model. Each has an id that never changes, which
 * flows use with this computer's id, and a name a rename changes.
 */
export const profiles = {
	list: ownerProcedure
		.route({
			summary:
				"Lists the profiles of this computer, with the nodes that use each.",
		})
		.output(output(profileListSchema))
		.handler(async ({ context }) => {
			const use = await context.space.flowUse();
			const self = context.daemon.device.id;
			return context.profiles.list().map((p) => ({
				...p,
				usedBy: use.profiles.get(profileUseKey(self, p.id)) ?? [],
			}));
		}),
	save: ownerProcedure
		.route({ summary: "Adds a profile, or changes or renames one." })
		.output(output(profileViewSchema))
		.input(
			z.union([
				agentProfileSchema.extend(edited),
				modelProfileSchema.extend(edited),
			]),
		)
		.handler(async ({ context, input }) => {
			const { id, ...profile } = input;
			const saved = await saveProfile(
				context,
				profile,
				id !== undefined ? { id } : {},
			);
			// The Spaces it is offered to show its new name.
			if (id !== undefined) {
				await context.offers.renamed(saved.id, context.session.user.id);
			}
			return saved;
		}),
	/**
	 * The profiles a flow of a project can use, by Device, for the
	 * session's Person: this computer's, their other Devices' that this
	 * computer has a copy of, and what other Persons offer to the Space.
	 */
	catalog: protectedProcedure
		.route({
			summary:
				"Lists the profiles a flow of a project can use, by Device: the Person's own, and those others offer to the Space.",
		})
		.output(output(profileCatalogSchema))
		.input(z.object({ spaceId: z.string().min(1), projectId: z.string() }))
		.handler(async ({ context, input }) => {
			if ((await context.access.roleIn(input.spaceId)) === null) {
				throw new ORPCError("NOT_FOUND", {
					message: "That Space does not exist.",
				});
			}
			const devices = await context.engine
				.space(input.spaceId, { personId: context.session.user.id })
				.listDevices(input.projectId);
			return devices.map((d) => ({
				deviceId: d.deviceId,
				name: d.name,
				thisDevice: d.thisDevice,
				mine: d.offers === undefined,
				online: d.online,
				profiles: d.profiles ?? null,
			}));
		}),
	/** Flows that name it refuse to start until they name another profile. */
	remove: ownerProcedure
		.route({
			summary:
				"Removes a profile. Flows that name it do not start until they name another.",
		})
		.output(output(z.void()))
		.input(z.object({ id: z.string() }))
		.handler(({ context, input }) => context.profiles.remove(input.id)),
};
