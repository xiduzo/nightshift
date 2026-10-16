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
		if (error instanceof ORPCError || !(error instanceof Error)) throw error;
		throw new ORPCError("BAD_REQUEST", {
			message: error.message,
			cause: error,
		});
	}
});

export const publicProcedure = o.use(readableErrors);

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);
