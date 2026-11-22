import type { FindToken } from "./find-token";
import type { Sessions } from "./ports";

export type PickHeadersPorts = {
	sessions: Pick<Sessions<unknown>, "read" | "hasCookie" | "withCookie">;
	/** The token of the local session (`findToken`, bound by the wire). */
	findToken: (request: FindToken) => Promise<string>;
};

/** Whose local session, for which request. */
export type PickHeaders = { personId: string; headers: Headers };

/**
 * The headers to pass on to Better Auth: the request's own when it
 * carries a live session, else with the local session's cookie. Reads no
 * session without a cookie of the request's own.
 */
export const pickHeaders =
	(ports: PickHeadersPorts) =>
	async (request: PickHeaders): Promise<Headers> => {
		const { personId, headers } = request;
		const own =
			(await ports.sessions.hasCookie(headers)) &&
			(await ports.sessions.read(headers)) !== null;
		if (own) return headers;
		return ports.sessions.withCookie(
			headers,
			await ports.findToken({ personId }),
		);
	};
