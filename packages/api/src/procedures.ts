import type { HostAccess, Permissions } from "@nightshift/auth";
import { HostUnreachableError } from "@nightshift/engine";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

/**
 * The engine and the stores throw errors written for people ("The run cap is
 * reached: …"). oRPC masks a plain Error as an internal server error, so pass
 * its message on as a bad request instead.
 */
const readableErrors = o.middleware(async ({ next }) => {
	try {
		return await next();
	} catch (error) {
		throw readable(error);
	}
});

/**
 * The code of an action that this computer cannot take to the Host that
 * keeps its Space now. A screen says so in its own words: the person
 * tries again later.
 */
const HOST_UNREACHABLE_CODE = "HOST_UNREACHABLE";

/**
 * An error written for people, as a bad request with its message. The
 * Host of the Space that cannot be reached is `HOST_UNREACHABLE` (503)
 * instead. A streaming handler throws after the middleware returned, so
 * it passes its errors through this itself.
 */
export function readable(error: unknown): unknown {
	if (error instanceof ORPCError || !(error instanceof Error)) return error;
	if (error instanceof HostUnreachableError) {
		return new ORPCError(HOST_UNREACHABLE_CODE, {
			status: 503,
			message: error.message,
			cause: error,
		});
	}
	return new ORPCError("BAD_REQUEST", { message: error.message, cause: error });
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
