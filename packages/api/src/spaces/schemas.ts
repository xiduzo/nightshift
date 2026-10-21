import type {
	InvitationView,
	PendingInvitation,
	Space,
	SpaceMember,
} from "@nightshift/auth";
import { z } from "zod";

import { exact } from "../output";

/** A role in a Space. */
export const roleSchema = z.enum(["owner", "admin", "member", "viewer"]);

/** A Space of the Person, with their role there. */
const spaceSchema = exact<Space>()(
	z.object({
		id: z.string(),
		name: z.string(),
		personal: z.boolean(),
		role: roleSchema,
	}),
);

export const spaceListSchema = z.object({
	/** The Space the session works in. */
	active: z.string(),
	/** The personal Space first. */
	spaces: z.array(spaceSchema),
});

const spaceMemberSchema = exact<SpaceMember>()(
	z.object({
		/** The membership. */
		id: z.string(),
		personId: z.string(),
		name: z.string(),
		email: z.string(),
		role: roleSchema,
		joinedAt: z.number(),
	}),
);

const pendingInvitationSchema = exact<PendingInvitation>()(
	z.object({
		id: z.string(),
		email: z.string(),
		role: roleSchema,
		inviterName: z.string(),
		expiresAt: z.number(),
	}),
);

/** The session's Space, its Members and invitations, and what the Person may change. */
export const memberListSchema = z.object({
	space: z.object({
		id: z.string(),
		name: z.string(),
		personal: z.boolean(),
		role: roleSchema.nullable(),
	}),
	/** The session's Person. */
	you: z.string(),
	members: z.array(spaceMemberSchema),
	invitations: z.array(pendingInvitationSchema),
	can: z.object({
		invite: z.boolean(),
		remove: z.boolean(),
		changeRole: z.boolean(),
	}),
});

/** An invitation as the page that accepts it shows it. */
export const invitationViewSchema = exact<InvitationView>()(
	z.object({
		id: z.string(),
		spaceName: z.string(),
		email: z.string(),
		role: roleSchema,
		inviterName: z.string(),
		/** `expired`: pending, but past its time. */
		status: z.enum(["pending", "accepted", "canceled", "rejected", "expired"]),
		/** A Person with this email exists on this Host: sign in, not sign up. */
		hasAccount: z.boolean(),
	}),
);
