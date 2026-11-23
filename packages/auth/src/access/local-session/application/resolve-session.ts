import { instant } from "@nightshift/time";
import type { SessionOf, TokenCell } from "../domain/local-token";
import type { FindToken } from "./find-token";
import type { Sessions } from "./ports";

export type ResolveSessionPorts<S extends SessionOf> = {
	sessions: Pick<Sessions<S>, "read" | "hasCookie" | "withCookie">;
	token: Pick<TokenCell, "keep" | "forget">;
	/** The token of the local session (`findToken`, bound by the wire). */
	findToken: (request: FindToken) => Promise<string>;
};

/** Whose local session, for which request. */
export type ResolveSession = { personId: string; headers: Headers };

/**
 * The request's own session, else the local Person's, with the headers
 * that carry it. Pass the headers on to Better Auth. A local session that
 * ended (signed out) gives way to a new one, once.
 */
export const resolveSession =
	<S extends SessionOf>(ports: ResolveSessionPorts<S>) =>
	async (
		request: ResolveSession,
	): Promise<{ session: S | null; headers: Headers }> => {
		const { personId, headers } = request;
		if (await ports.sessions.hasCookie(headers)) {
			const own = await ports.sessions.read(headers);
			if (own) return { session: own, headers };
		}
		const local = async (
			retry: boolean,
		): Promise<{ session: S | null; headers: Headers }> => {
			const token = await ports.findToken({ personId });
			const withLocal = await ports.sessions.withCookie(headers, token);
			const session = await ports.sessions.read(withLocal);
			if (session) {
				ports.token.keep({
					token: session.session.token,
					expiresAt: instant(session.session.expiresAt),
				});
				return { session, headers: withLocal };
			}
			ports.token.forget();
			return retry ? local(false) : { session: null, headers: withLocal };
		};
		return local(true);
	};
