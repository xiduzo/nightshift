import { asDate } from "@nightshift/time";
import type { Sessions } from "../../application/ports";
import type { LocalToken } from "../../domain/local-token";

/** A session as the in-memory `Sessions` gives it: the shape Better Auth's has, in short. */
export type TestSession = {
	user: { id: string };
	session: { id: string; userId: string; token: string; expiresAt: Date };
};

/** How long a new session lives in the twin (ms). */
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/** The cookie that carries a session in the twin. */
const COOKIE = "session";

/** The token a cookie header of the twin carries, or null. */
function tokenOf(headers: Headers): string | null {
	for (const part of (headers.get("cookie") ?? "").split(";")) {
		const [name, value] = part.trim().split("=");
		if (name === COOKIE && value) return value;
	}
	return null;
}

/**
 * `Sessions` in memory. A session lives in `sessions` by its token. The
 * twin's clock is `now`: a test sets it. Every call is in `calls`.
 */
export function inMemorySessions() {
	const sessions = new Map<string, LocalToken & { personId: string }>();
	let next = 0;
	const twin = {
		sessions,
		/** The twin's time (ms). */
		now: 0,
		/** Every call, in order, by name. */
		calls: [] as (keyof Sessions<TestSession>)[],
		/** Adds a session of the Person, as the real adapter would find it. */
		add(personId: string, token: LocalToken) {
			sessions.set(token.token, { ...token, personId });
		},
		/** The headers of a request that carries the session of `token`. */
		cookie(token: string): Headers {
			return new Headers({ cookie: `${COOKIE}=${token}` });
		},
		async read(headers: Headers): Promise<TestSession | null> {
			twin.calls.push("read");
			const token = tokenOf(headers);
			const found = token ? sessions.get(token) : undefined;
			if (!found || found.expiresAt <= twin.now) return null;
			return {
				user: { id: found.personId },
				session: {
					id: `session-${found.token}`,
					userId: found.personId,
					token: found.token,
					expiresAt: asDate(found.expiresAt),
				},
			};
		},
		async hasCookie(headers: Headers) {
			twin.calls.push("hasCookie");
			return tokenOf(headers) !== null;
		},
		async withCookie(headers: Headers, token: string) {
			twin.calls.push("withCookie");
			const copy = new Headers(headers);
			copy.set("cookie", `${COOKIE}=${token}`);
			return copy;
		},
		async latest(personId: string, at: number) {
			twin.calls.push("latest");
			let best: LocalToken | null = null;
			for (const found of sessions.values()) {
				if (found.personId !== personId || found.expiresAt <= at) continue;
				if (!best || found.expiresAt > best.expiresAt) {
					best = { token: found.token, expiresAt: found.expiresAt };
				}
			}
			return best;
		},
		async create(personId: string) {
			twin.calls.push("create");
			next += 1;
			const token = {
				token: `token-${next}`,
				expiresAt: twin.now + SESSION_MS,
			};
			sessions.set(token.token, { ...token, personId });
			return token;
		},
	};
	return twin satisfies Sessions<TestSession>;
}

export type InMemorySessions = ReturnType<typeof inMemorySessions>;
