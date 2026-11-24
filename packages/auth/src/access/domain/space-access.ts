import { Refusal } from "@nightshift/refusal";

/**
 * A session as access reads it: its Person, their two-factor state, and
 * the session's active Space. The wire names Better Auth's full type.
 */
export type SessionOf = {
	user: { id: string; twoFactorEnabled?: boolean | null };
	session: { userId: string; activeOrganizationId?: string | null };
};

/** The code of a Host that asks for two-factor sign-in (`TWO_FACTOR_REQUIRED` of `host-access/`). */
export type TwoFactorRequired = "TWO_FACTOR_REQUIRED";

/** Whether the Host lets a session in, as `host-access/` decides it (`HostAccess`). */
export type HostDecision =
	| { allowed: true }
	| { allowed: false; code: TwoFactorRequired; message: string };

/**
 * Why a request may not go on: the code a screen reads, the HTTP status
 * and the words the person sees. A procedure and a file route answer the
 * same refusal, so each refusal has its words in one place.
 */
export type AccessRefusal = {
	allowed: false;
	code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | TwoFactorRequired;
	status: 401 | 403 | 404;
	message: string;
};

/** A request that works in a Space: its session and that Space. Else why not. */
export type SpaceAccessOf<S> =
	| { allowed: true; session: S; spaceId: string }
	| AccessRefusal;

/** A request without a session. */
export const SIGNED_OUT: AccessRefusal = {
	allowed: false,
	code: "UNAUTHORIZED",
	status: 401,
	message: "Sign in to use Night Shift.",
};

/** A Person whose role in the Space does not allow the request. */
export const ROLE_REFUSAL: AccessRefusal = {
	allowed: false,
	code: "FORBIDDEN",
	status: 403,
	message:
		"Your role in this Space does not allow this. Ask an owner or admin of the Space to change your role.",
};

/**
 * The refusal of a Person whose role in the Space does not allow the
 * request, in the words of `ROLE_REFUSAL`. A use case of the engine throws
 * it, and each door answers it as `ROLE_REFUSAL` (403).
 */
export class RoleRefusal extends Refusal {
	constructor() {
		super("forbidden", ROLE_REFUSAL.message);
		this.name = "RoleRefusal";
	}
}

/**
 * The first rungs of every request that works in a Space: a session, in
 * a Space, that the Host lets in (`host-access/`).
 */
export function spaceAccess<S extends { user: unknown }>(access: {
	session: S | null;
	spaceId: string | null;
	hostAccess: HostDecision;
}): SpaceAccessOf<S> {
	const { session, spaceId, hostAccess } = access;
	if (!session?.user || !spaceId) return SIGNED_OUT;
	if (!hostAccess.allowed) return { ...hostAccess, status: 403 };
	return { allowed: true, session, spaceId };
}
