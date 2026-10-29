import type { Session } from "../auth";
import type { TWO_FACTOR_REQUIRED } from "../host-access";
import type { RequestAccess } from "./request";

/**
 * Why a request may not go on: the code a screen reads, the HTTP status
 * and the words the person sees. A procedure and a file route answer the
 * same refusal, so each refusal has its words in one place.
 */
export type AccessRefusal = {
	allowed: false;
	code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | typeof TWO_FACTOR_REQUIRED;
	status: 401 | 403 | 404;
	message: string;
};

/** A request that works in a Space: its session and that Space. Else why not. */
export type SpaceAccess =
	| { allowed: true; session: Session; spaceId: string }
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
	message: "Your role in this Space does not allow this.",
};

/**
 * The first rungs of every request that works in a Space: a session, in
 * a Space, that the Host lets in (`host-access/`).
 */
export function spaceAccess(
	access: Pick<RequestAccess, "session" | "spaceId" | "hostAccess">,
): SpaceAccess {
	const { session, spaceId, hostAccess } = access;
	if (!session?.user || !spaceId) return SIGNED_OUT;
	if (!hostAccess.allowed) return { ...hostAccess, status: 403 };
	return { allowed: true, session, spaceId };
}
