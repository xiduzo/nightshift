import type { Context as ApiContext } from "@nightshift/api/context";
import { setLogin } from "@nightshift/auth/login";
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
	hostPolicy,
	localSession,
	offers,
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
 * this computer's Person, even from a loopback address. `hostAccess` says
 * whether the session may use the Host (`@nightshift/auth/host-access`).
 */
export function access(context: HonoContext) {
	const headers = context.req.raw.headers;
	return requestAccess(
		auth,
		db,
		headers,
		isLocal(context) ? localSession : null,
		hostPolicy,
	);
}

/** From this computer, and no Device: a Device is never this computer's Person. */
function isLocal(context: HonoContext): boolean {
	return (
		!context.req.raw.headers.has("authorization") &&
		fromThisComputer(context, trustedOrigins)
	);
}

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const deviceKey = await host.keyOf(context.req.raw.headers);
	const {
		session,
		spaceId,
		can,
		setActiveSpace,
		createSpace,
		members,
		headers,
		hostAccess,
	} = deviceKey
		? await requestAccess(auth, db, new Headers(), null)
		: await access(context);
	return {
		session,
		spaceId,
		can,
		setActiveSpace,
		headers,
		hostAccess,
		requireTwoFactor: hostPolicy.requireTwoFactor,
		fromThisComputer: !deviceKey && isLocal(context),
		setLogin: (personId, input) => setLogin(auth, personId, input),
		deviceKey,
		devices,
		exchange: hostExchange,
		offers,
		createSpace,
		members,
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
