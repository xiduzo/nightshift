import type { SessionOf } from "../domain/space-access";
import { type HostAccess, type HostPolicy, hostAccess } from "../host-access";
import type { LocalSessions, SessionReader } from "./ports";

export type OpenAuthEndpointPorts<S> = {
	sessionReader: SessionReader<S>;
};

/** A call to Better Auth's own endpoints: as `OpenRequest`. */
export type OpenAuthEndpoint<S> = {
	headers: Headers;
	local: LocalSessions<S> | null;
	policy: HostPolicy;
};

/**
 * The headers and the Host's decision for a call to Better Auth's own
 * endpoints, which read the session themselves. It reads the session only
 * when the decision needs it: a session from another computer, on a Host
 * that requires two-factor sign-in.
 */
export const openAuthEndpoint =
	<S extends SessionOf>(ports: OpenAuthEndpointPorts<S>) =>
	async (
		request: OpenAuthEndpoint<S>,
	): Promise<{ headers: Headers; hostAccess: HostAccess }> => {
		const { headers, local, policy } = request;
		if (local) {
			return {
				headers: await local.headers(headers),
				hostAccess: hostAccess(policy, {
					session: null,
					fromThisComputer: true,
				}),
			};
		}
		const session = policy.requireTwoFactor
			? await ports.sessionReader.read(headers)
			: null;
		return {
			headers,
			hostAccess: hostAccess(policy, { session, fromThisComputer: false }),
		};
	};
