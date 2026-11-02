import type { InsightsDb } from "@nightshift/insights";
import { ORPCError, os } from "@orpc/server";

export type InsightsSession = {
	user: { id: string; email: string; name: string };
};

type Context = {
	db: InsightsDb;
	session: InsightsSession | null;
};

const o = os.$context<Context>();

/** A signed-in person. Anyone else is refused. */
export const signedIn = o.use(async ({ context, next }) => {
	if (!context.session) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Sign in to see these numbers.",
		});
	}
	return next({
		context: { db: context.db, session: context.session },
	});
});
