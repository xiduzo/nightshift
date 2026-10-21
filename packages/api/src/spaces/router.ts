import { invitationView, membersOf, spacesOf } from "@nightshift/auth";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { output } from "../output";
import { permitted, protectedProcedure, publicProcedure } from "../procedures";
import {
	invitationViewSchema,
	memberListSchema,
	roleSchema,
	spaceListSchema,
} from "./schemas";

/** The Person's Spaces, and the one the session works in. */
export const spaces = {
	/** The personal Space first. `active` is the session's Space. */
	list: protectedProcedure
		.route({
			summary:
				"Lists the Person's Spaces, personal first, and the one the session works in.",
		})
		.output(output(spaceListSchema))
		.handler(async ({ context }) => ({
			active: context.spaceId,
			spaces: await spacesOf(context.db, context.session.user.id),
		})),
	/** Every later call works in this Space. */
	switch: protectedProcedure
		.route({
			summary:
				"Makes another of the Person's Spaces the one the session works in.",
		})
		.output(output(z.void()))
		.input(z.object({ spaceId: z.string().min(1) }))
		.handler(async ({ context, input }) => {
			await context.setActiveSpace(input.spaceId);
		}),
	/** A new Space with the Person as its owner. Later calls work in it. */
	create: protectedProcedure
		.route({
			summary: "Creates a Space with the Person as its owner, and works in it.",
		})
		.output(output(z.object({ id: z.string() })))
		.input(z.object({ name: z.string().trim().min(1).max(60) }))
		.handler(({ context, input }) => context.createSpace(input.name)),
};

const role = roleSchema;

/**
 * The Members of the session's Space: who is in it with which role, and
 * who is invited. Each change needs its `member` permission; the
 * organization plugin checks the role again. A personal Space has one
 * Member and takes no invitations.
 */
export const members = {
	list: protectedProcedure
		.route({
			summary:
				"Lists the Members and pending invitations of the session's Space.",
		})
		.output(output(memberListSchema))
		.handler(async ({ context }) => {
			const [listed, spaces, invite, remove, changeRole] = await Promise.all([
				membersOf(context.db, context.spaceId),
				spacesOf(context.db, context.session.user.id),
				context.can({ member: ["invite"] }),
				context.can({ member: ["remove"] }),
				context.can({ member: ["role"] }),
			]);
			const space = spaces.find((s) => s.id === context.spaceId);
			return {
				space: {
					id: context.spaceId,
					name: space?.name ?? "",
					personal: space?.personal ?? false,
					role: space?.role ?? null,
				},
				you: context.session.user.id,
				...listed,
				can: { invite, remove, changeRole },
			};
		}),
	/** Invites an email with a role. The link to accept it carries the invitation's id. */
	invite: permitted({ member: ["invite"] })
		.route({ summary: "Invites an email to the Space with a role." })
		.output(output(z.object({ id: z.string() })))
		.input(
			z.object({
				email: z.email().max(254),
				role: role.exclude(["owner"]),
			}),
		)
		.handler(({ context, input }) =>
			context.members.invite(input.email.toLowerCase(), input.role),
		),
	cancelInvitation: permitted({ member: ["invite"] })
		.route({ summary: "Cancels a pending invitation." })
		.output(output(z.void()))
		.input(z.object({ invitationId: z.string().min(1) }))
		.handler(({ context, input }) =>
			context.members.cancelInvitation(input.invitationId),
		),
	setRole: permitted({ member: ["role"] })
		.route({ summary: "Gives a Member another role in the Space." })
		.output(output(z.void()))
		.input(z.object({ memberId: z.string().min(1), role }))
		.handler(({ context, input }) =>
			context.members.setRole(input.memberId, input.role),
		),
	remove: permitted({ member: ["remove"] })
		.route({ summary: "Removes a Member from the Space." })
		.output(output(z.void()))
		.input(z.object({ memberId: z.string().min(1) }))
		.handler(({ context, input }) => context.members.remove(input.memberId)),
};

/**
 * Invitations, as the person who got the link sees them. `get` is public:
 * the id is the link's secret, and the page shows it before anyone signs
 * in. `accept` needs a session of the invited email.
 */
export const invitations = {
	get: publicProcedure
		.route({
			summary:
				"Reads an invitation by the id in its link, before anyone signs in.",
		})
		.output(output(invitationViewSchema))
		.input(z.object({ invitationId: z.string().min(1).max(128) }))
		.handler(async ({ context, input }) => {
			const found = await invitationView(context.db, input.invitationId);
			if (!found) {
				throw new ORPCError("NOT_FOUND", {
					message: "This invitation does not exist. Ask for a new one.",
				});
			}
			return found;
		}),
	/** Joins the invitation's Space and works in it from now on. */
	accept: protectedProcedure
		.route({
			summary:
				"Accepts an invitation: the Person joins its Space and works in it.",
		})
		.output(output(z.object({ spaceId: z.string() })))
		.input(z.object({ invitationId: z.string().min(1).max(128) }))
		.handler(({ context, input }) =>
			context.members.accept(input.invitationId),
		),
};
