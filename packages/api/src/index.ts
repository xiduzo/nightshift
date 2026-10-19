import type { Permissions } from "@nightshift/auth";
import type { DeviceKeyPermission } from "@nightshift/auth/device-keys";
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
 * An error written for people, as a bad request with its message. A
 * streaming handler throws after the middleware returned, so it passes its
 * errors through this itself.
 */
export function readable(error: unknown): unknown {
	if (error instanceof ORPCError || !(error instanceof Error)) return error;
	return new ORPCError("BAD_REQUEST", { message: error.message, cause: error });
}

/** No session needed: the health check only. */
export const publicProcedure = o.use(readableErrors);

/**
 * A session in a Space. The handler gets `space`: the engine as that Space
 * sees it, so nothing it reads or changes is of another Space.
 */
const requireSpace = o.middleware(async ({ context, next }) => {
	if (!context.session?.user || !context.spaceId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Sign in to use Night Shift.",
		});
	}
	return next({
		context: {
			session: context.session,
			spaceId: context.spaceId,
			space: context.engine.space(context.spaceId),
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

/**
 * This computer's own configuration (settings, harnesses, profiles,
 * connections, CLI tools): private to the Person who owns it, in any Space.
 */
export const ownerProcedure = protectedProcedure.use(
	async ({ context, next }) => {
		if (context.session.user.id !== context.daemon.device.ownerId) {
			throw new ORPCError("FORBIDDEN", {
				message: "Only the owner of this computer can see or change this.",
			});
		}
		return next();
	},
);

/**
 * A call of a paired Device, with its Device key, for a key that allows
 * `need`. A Device is not a Person: it has no session and no Space here.
 */
export function deviceProcedure(need: DeviceKeyPermission) {
	return publicProcedure.use(async ({ context, next }) => {
		const key = context.deviceKey;
		if (!key) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "This device has no access here. Pair it again.",
			});
		}
		if (!key.permissions[need]?.length) {
			throw new ORPCError("FORBIDDEN", {
				message: "This device may not do this here.",
			});
		}
		return next({ context: { deviceKey: key } });
	});
}
