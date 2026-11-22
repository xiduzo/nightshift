import { Refusal, type RefusalKind } from "@nightshift/refusal";

import { ROLE_REFUSAL } from "./space-access";

/**
 * What Better Auth refuses for a Person's request (an invitation, a role,
 * a Space), as a `Refusal` in Night Shift's words. Better Auth's own words
 * name its internals ("organization"), so each code it uses here gets
 * Night Shift's words, and a refusal Night Shift wrote in a hook keeps
 * its own. Any other error stays as it is: a failure.
 */

/** The codes of the organization plugin that a Person's request can meet, in Night Shift's words. */
const KNOWN: Record<string, { kind: RefusalKind; message: string }> = {
	USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: {
		kind: "conflict",
		message: "This person is a member of this Space already.",
	},
	USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: {
		kind: "conflict",
		message: "This person has an invitation to this Space already.",
	},
	INVITATION_NOT_FOUND: {
		kind: "not-found",
		message: "This invitation does not exist anymore. Ask for a new one.",
	},
	YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: {
		kind: "forbidden",
		message:
			"This invitation is for another email. Sign in with the email that got it.",
	},
	MEMBER_NOT_FOUND: {
		kind: "not-found",
		message: "This person is not a member of this Space anymore.",
	},
	ORGANIZATION_NOT_FOUND: {
		kind: "not-found",
		message: "That Space does not exist.",
	},
	USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: {
		kind: "forbidden",
		message: "You are not a member of that Space.",
	},
	YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION: {
		kind: "forbidden",
		message: "You are not a member of that Space.",
	},
	YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: {
		kind: "conflict",
		message: "A Space needs an owner. Make another member an owner first.",
	},
	YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: {
		kind: "conflict",
		message: "A Space needs an owner. Make another member an owner first.",
	},
	INVITATION_LIMIT_REACHED: {
		kind: "conflict",
		message:
			"This Space has too many open invitations. Cancel one, then try again.",
	},
	ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: {
		kind: "conflict",
		message: "This Space has as many members as it can have.",
	},
};

/** The shape of a Better Auth error that matters here. */
type AuthError = {
	status?: unknown;
	body?: { code?: unknown };
	cause?: unknown;
};

/** `error` as a refusal when Better Auth refused the request, else `error` itself. */
export function refusalOf(error: unknown): unknown {
	if (typeof error !== "object" || error === null) return error;
	const { status, body, cause } = error as AuthError;
	if (cause instanceof Refusal) return cause;
	const known = typeof body?.code === "string" ? KNOWN[body.code] : undefined;
	if (known) return new Refusal(known.kind, known.message, { cause: error });
	// Any other refusal of a role that does not allow the request.
	if (status === "FORBIDDEN") {
		return new Refusal("forbidden", ROLE_REFUSAL.message, { cause: error });
	}
	return error;
}

/** Throws `error` as a refusal when Better Auth refused the request: for a `.catch`. */
export function refuse(error: unknown): never {
	throw refusalOf(error);
}
