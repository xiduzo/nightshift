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
	devices,
	engine,
	host,
	hostExchange,
	localSession,
	profiles,
	projectSetup,
	settings,
} from "./services";
import { fromThisComputer } from "./this-computer";

export type CreateContextOptions = {
	context: HonoContext;
};

/**
 * The request's session and Space: the local session for this computer. A
 * request with a Device key (`Authorization: Bearer`) is a Device, never
 * this computer's Person, even from a loopback address.
 */
export function access(context: HonoContext) {
	const headers = context.req.raw.headers;
	const local =
		!headers.has("authorization") && fromThisComputer(context, trustedOrigins);
	return requestAccess(auth, db, headers, local ? localSession : null);
}

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const deviceKey = await host.keyOf(context.req.raw.headers);
	const { session, spaceId, can, setActiveSpace, createSpace, headers } =
		deviceKey
			? await requestAccess(auth, db, new Headers(), null)
			: await access(context);
	return {
		session,
		spaceId,
		can,
		setActiveSpace,
		headers,
		deviceKey,
		devices,
		exchange: hostExchange,
		createSpace,
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
