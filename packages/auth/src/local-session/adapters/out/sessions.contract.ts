import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Sessions } from "../../application/ports";
import type { SessionOf } from "../../domain/local-token";

/** One adapter of `Sessions` to test, with a Person who has no session yet. */
export type SessionsUnderTest<S> = {
	sessions: Sessions<S>;
	personId: string;
	/** The Person a session belongs to. */
	personOf(session: S): string;
	/** The adapter's time now (ms). */
	now(): number;
	close(): Promise<void>;
};

/** A year (ms): later than any new session lives. */
const YEAR = 365 * 24 * 60 * 60 * 1000;

/**
 * What every adapter of `Sessions` does. `sessions.contract.test.ts` runs
 * it on the in-memory adapter and on the real one.
 */
export function sessionsContract<S extends SessionOf>(
	name: string,
	make: () => Promise<SessionsUnderTest<S>>,
): void {
	describe(`Sessions contract: ${name}`, () => {
		let under: SessionsUnderTest<S>;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("headers without a cookie carry no session", async () => {
			expect(await under.sessions.hasCookie(new Headers())).toBe(false);
			expect(await under.sessions.read(new Headers())).toBeNull();
		});

		test("a new session is the latest, and its cookie carries it", async () => {
			const { sessions, personId } = under;
			expect(await sessions.latest(personId, under.now())).toBeNull();
			const created = await sessions.create(personId);
			expect(created.expiresAt).toBeGreaterThan(under.now());
			expect(await sessions.latest(personId, under.now())).toEqual(created);
			expect(await sessions.latest(personId, under.now() + YEAR)).toBeNull();

			const headers = await sessions.withCookie(
				new Headers({ origin: "http://localhost:3001" }),
				created.token,
			);
			expect(headers.get("origin")).toBe("http://localhost:3001");
			expect(await sessions.hasCookie(headers)).toBe(true);
			const read = await sessions.read(headers);
			expect(read?.session.token).toBe(created.token);
			expect(read ? under.personOf(read) : null).toBe(personId);
		});

		test("the cookie of a token that is no session carries none", async () => {
			const headers = await under.sessions.withCookie(
				new Headers(),
				"no-such-token",
			);
			expect(await under.sessions.hasCookie(headers)).toBe(true);
			expect(await under.sessions.read(headers)).toBeNull();
		});
	});
}
