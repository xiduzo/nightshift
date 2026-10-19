import type { Context as ApiContext } from "@nightshift/api/context";
import { requestAccess } from "@nightshift/auth/request";
import type { Context as HonoContext } from "hono";

import { trustedOrigins } from "./env.server";
import {
	auth,
	checks,
	cliTools,
	connections,
	daemon,
	db,
	engine,
	localSession,
	profiles,
	projectSetup,
	settings,
} from "./services";
import { fromThisComputer } from "./this-computer";

export type CreateContextOptions = {
	context: HonoContext;
};

/** The request's session and Space: the local session for this computer. */
export function access(context: HonoContext) {
	return requestAccess(
		auth,
		db,
		context.req.raw.headers,
		fromThisComputer(context, trustedOrigins) ? localSession : null,
	);
}

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const { session, spaceId, can, setActiveSpace } = await access(context);
	return {
		session,
		spaceId,
		can,
		setActiveSpace,
		db,
		engine,
		settings,
		connections,
		cliTools,
		profiles,
		checks,
		projectSetup,
		daemon,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
