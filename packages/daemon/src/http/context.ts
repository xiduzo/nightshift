import type {
	Context as ApiContext,
	Services as ApiServices,
} from "@nightshift/api/context";
import {
	type Auth,
	authEndpointAccess,
	type HostPolicy,
	type LocalSession,
	requestAccess,
	setLogin,
} from "@nightshift/auth";
import type { Context as HonoContext } from "hono";

import { fromThisComputer } from "./this-computer";

/**
 * What the procedures get besides the request (the API's `Services`), and
 * what reads a request's access. The daemon's composition root
 * (`createDaemon`) fills it. The services pass to every request as they
 * are: a new one needs no change here.
 */
export type HttpServices = ApiServices & {
	auth: Auth;
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
	/**
	 * What a call to Better Auth's own endpoints needs: the headers to pass
	 * on (the local session for this computer) and whether the Host lets
	 * the session in. Better Auth reads the session itself.
	 */
	authAccess(context: HonoContext): ReturnType<typeof authEndpointAccess>;
	/**
	 * The oRPC context of a request. `signedOut`: the request needs no
	 * session (the API reference), so none is read.
	 */
	createContext(
		context: HonoContext,
		options?: { signedOut?: boolean },
	): Promise<ApiContext>;
};

export function requestContexts(services: HttpServices): RequestContexts {
	const {
		auth,
		localSession,
		hostPolicy,
		trustedOrigins,
		deviceKeyOf,
		...apiServices
	} = services;
	const { db } = apiServices;

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
		authAccess: (context) =>
			authEndpointAccess(
				auth,
				context.req.raw.headers,
				isLocal(context) ? localSession : null,
				hostPolicy,
			),
		async createContext(context, options = {}) {
			const deviceKey = options.signedOut
				? null
				: await deviceKeyOf(context.req.raw.headers);
			const signedOut = deviceKey !== null || options.signedOut === true;
			return {
				...apiServices,
				access: signedOut
					? await requestAccess(auth, db, new Headers(), null)
					: await access(context),
				deviceKey,
				fromThisComputer: !signedOut && isLocal(context),
				requireTwoFactor: hostPolicy.requireTwoFactor,
				setLogin: (personId, input) => setLogin(auth, personId, input),
			};
		},
	};
}
