import type { SessionReader } from "../../application/ports";

/** A session as the in-memory adapters of access give it: the shape Better Auth's has, in short. */
export type TestSession = {
	user: { id: string; twoFactorEnabled?: boolean | null };
	session: { id: string; userId: string; activeOrganizationId?: string | null };
};

/** The headers of a request that carries the session of `token`, as the twins read them. */
export function cookieOf(token: string): Headers {
	return new Headers({ cookie: `session=${token}` });
}

/** The token the headers carry, as the twins write it, or null. */
export function tokenOf(headers: Headers): string | null {
	const found = /(?:^|;\s*)session=([^;]+)/.exec(headers.get("cookie") ?? "");
	return found?.[1] ?? null;
}

/**
 * `SessionReader` in memory. A test signs a Person in (`signIn`) where the
 * real adapter would find a session, and reads `reads` after a call.
 */
export function inMemorySessionReader() {
	const sessions = new Map<string, TestSession>();
	const twin = {
		sessions,
		/** How many times a session was read. */
		reads: 0,
		/**
		 * A live session of the Person, and the headers that carry it. The
		 * session's active Space is `activeSpaceId`, when given.
		 */
		signIn(
			personId: string,
			options: { activeSpaceId?: string; twoFactorEnabled?: boolean } = {},
		): Headers {
			const token = `token-${sessions.size + 1}`;
			sessions.set(token, {
				user: {
					id: personId,
					twoFactorEnabled: options.twoFactorEnabled ?? false,
				},
				session: {
					id: `session-${token}`,
					userId: personId,
					activeOrganizationId: options.activeSpaceId ?? null,
				},
			});
			return cookieOf(token);
		},
		async read(headers: Headers) {
			twin.reads += 1;
			const token = tokenOf(headers);
			return (token && sessions.get(token)) || null;
		},
	};
	return twin satisfies SessionReader<TestSession>;
}

export type InMemorySessionReader = ReturnType<typeof inMemorySessionReader>;
