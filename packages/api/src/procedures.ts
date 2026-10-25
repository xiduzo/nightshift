import type { HostAccess, Permissions } from "@nightshift/auth";
import { HostUnreachableError } from "@nightshift/engine";
import {
	FAILURE_MESSAGE,
	Refusal,
	type RefusalKind,
} from "@nightshift/refusal";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

/** Every error of a procedure goes through `readable`, the one rule at the API seam. */
const readableErrors = o.middleware(async ({ next, path }) => {
	try {
		return await next();
	} catch (error) {
		throw readable(error, path);
	}
});

/**
 * The code of an action that this computer cannot take to the Host that
 * keeps its Space now. A screen says so in its own words: the person
 * tries again later.
 */
const HOST_UNREACHABLE_CODE = "HOST_UNREACHABLE";

/** The oRPC code of each kind of refusal. oRPC gives each its HTTP status. */
const REFUSAL_CODES: Record<RefusalKind, string> = {
	invalid: "BAD_REQUEST",
	"signed-out": "UNAUTHORIZED",
	forbidden: "FORBIDDEN",
	"not-found": "NOT_FOUND",
	conflict: "CONFLICT",
	unavailable: "SERVICE_UNAVAILABLE",
};

/**
 * The error a person gets for `error`, thrown by the procedure at `path`:
 * - An `ORPCError` passes on as it is: a declared error of the procedure
 *   (`.errors`), or a refusal the API writes itself.
 * - The Host of the Space that cannot be reached is `HOST_UNREACHABLE` (503).
 * - A `Refusal` is the status of its kind, with its own words.
 * - Anything else is a failure: a 500 with plain words. The error, with
 *   its stack and the procedure's path, goes to the log, never to the person.
 * A streaming handler throws after the middleware returned, so it passes
 * its errors through this itself.
 */
export function readable(
	error: unknown,
	path: readonly string[],
): ORPCError<string, unknown> {
	if (error instanceof ORPCError) return error;
	if (error instanceof HostUnreachableError) {
		return new ORPCError(HOST_UNREACHABLE_CODE, {
			status: 503,
			message: error.message,
			cause: error,
		});
	}
	if (error instanceof Refusal) {
		return new ORPCError(REFUSAL_CODES[error.kind], {
			message: error.message,
			cause: error,
		});
	}
	console.error(`[api] ${path.join(".") || "a procedure"} failed:`, error);
	return new ORPCError("INTERNAL_SERVER_ERROR", {
		message: FAILURE_MESSAGE,
		cause: error,
	});
}

/** No session needed: the health check only. */
export const publicProcedure = o.use(readableErrors);

/**
 * The refusal of a session the Host does not let in (two-factor required,
 * not on), with the code the web UI looks for.
 */
export function hostRefusal(
	access: Extract<HostAccess, { allowed: false }>,
): ORPCError<string, unknown> {
	return new ORPCError(access.code, { status: 403, message: access.message });
}

/**
 * A session in a Space, that the Host lets in. The handler gets `space`:
 * the engine as that Space sees it, so nothing it reads or changes is of
 * another Space.
 */
const requireSpace = o.middleware(async ({ context, next }) => {
	if (!context.session?.user || !context.spaceId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Sign in to use Night Shift.",
		});
	}
	if (!context.hostAccess.allowed) throw hostRefusal(context.hostAccess);
	return next({
		context: {
			session: context.session,
			spaceId: context.spaceId,
			space: context.engine.space(context.spaceId, {
				personId: context.session.user.id,
			}),
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireSpace);

/**
 * A procedure that needs a role allowing `permissions` in the session's
 * Space (`run.start`, `gate.resolve`, …), checked on the server.
 */
export function permitted(permissions: Permissions) {
	return protectedProcedure.use(async ({ context, next }) => {
		if (!(await context.can(permissions))) {
			throw new ORPCError("FORBIDDEN", {
				message: "Your role in this Space does not allow this.",
			});
		}
		return next();
	});
}

/** Lets only the Person who owns this computer through. */
export const ownerOnly = o.middleware(async ({ context, next }) => {
	if (context.session?.user.id !== context.daemon.device.ownerId) {
		throw new ORPCError("FORBIDDEN", {
			message: "Only the owner of this computer can see or change this.",
		});
	}
	return next();
});

/**
 * This computer's own configuration (settings, harnesses, profiles,
 * connections, CLI tools): private to the Person who owns it, in any Space.
 */
export const ownerProcedure = protectedProcedure.use(ownerOnly);
