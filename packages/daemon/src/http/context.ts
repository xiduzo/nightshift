import type { Context as ApiContext } from "@nightshift/api/context";
import {
	type Auth,
	type HostPolicy,
	type LocalSession,
	requestAccess,
	setLogin,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { Context as HonoContext } from "hono";

import { fromThisComputer } from "./this-computer";

/**
 * What the procedures get besides the request: the daemon's services. The
 * daemon's composition root (`createDaemon`) fills it.
 */
export type HttpServices = Pick<
	ApiContext,
	| "devices"
	| "exchange"
	| "offers"
	| "db"
	| "engine"
	| "settings"
	| "notifications"
	| "connections"
	| "cliTools"
	| "toolLaunchers"
	| "profiles"
	| "checks"
	| "projectSetup"
	| "daemon"
> & {
	auth: Auth;
	db: Database;
	localSession: LocalSession;
	hostPolicy: HostPolicy;
	/** Pages that may call this daemon (`origins.ts`). */
	trustedOrigins: ReadonlySet<string>;
	/** The Device a request's key (`Authorization: Bearer`) belongs to, else null. */
	deviceKeyOf: (headers: Headers) => Promise<ApiContext["deviceKey"]>;
};

export type RequestContexts = {
	/**
	 * The request's session and Space: the local session for this computer.
	 * A request with a Device key (`Authorization: Bearer`) is a Device,
	 * never this computer's Person, even from a loopback address.
	 * `hostAccess` says whether the session may use the Host.
	 */
	access(context: HonoContext): ReturnType<typeof requestAccess>;
	/** The oRPC context of a request. */
	createContext(context: HonoContext): Promise<ApiContext>;
};

export function requestContexts(services: HttpServices): RequestContexts {
	const { auth, db, localSession, hostPolicy, trustedOrigins } = services;

	/** From this computer, and no Device: a Device is never this computer's Person. */
	const isLocal = (context: HonoContext): boolean =>
		!context.req.raw.headers.has("authorization") &&
		fromThisComputer(context, trustedOrigins);

	const access = (context: HonoContext) =>
		requestAccess(
			auth,
			db,
			context.req.raw.headers,
			isLocal(context) ? localSession : null,
			hostPolicy,
		);

	return {
		access,
		async createContext(context) {
			const deviceKey = await services.deviceKeyOf(context.req.raw.headers);
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
				devices: services.devices,
				exchange: services.exchange,
				offers: services.offers,
				createSpace,
				members,
				db,
				engine: services.engine,
				settings: services.settings,
				notifications: services.notifications,
				connections: services.connections,
				cliTools: services.cliTools,
				toolLaunchers: services.toolLaunchers,
				profiles: services.profiles,
				checks: services.checks,
				projectSetup: services.projectSetup,
				daemon: services.daemon,
			};
		},
	};
}
