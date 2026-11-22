import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SessionReader } from "../../application/ports";
import type { SessionOf } from "../../domain/space-access";

/** One adapter of `SessionReader` to test. */
export type SessionReaderUnderTest<S> = {
	sessionReader: SessionReader<S>;
	/** A Person signed in: their id, and the headers of their session. */
	signIn(): Promise<{ personId: string; headers: Headers }>;
	close(): Promise<void>;
};

/**
 * What every adapter of `SessionReader` does.
 * `session-reader.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function sessionReaderContract<S extends SessionOf>(
	name: string,
	make: () => Promise<SessionReaderUnderTest<S>>,
): void {
	describe(`SessionReader contract: ${name}`, () => {
		let under: SessionReaderUnderTest<S>;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("headers without a session read none", async () => {
			expect(await under.sessionReader.read(new Headers())).toBeNull();
			expect(
				await under.sessionReader.read(
					new Headers({ cookie: "session=no-such-token" }),
				),
			).toBeNull();
		});

		test("the headers of a session read its Person", async () => {
			const { personId, headers } = await under.signIn();
			const session = await under.sessionReader.read(headers);
			expect(session?.user.id).toBe(personId);
			expect(session?.session.userId).toBe(personId);
		});
	});
}
