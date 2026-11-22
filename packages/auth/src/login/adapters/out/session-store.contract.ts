import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseInstant } from "@nightshift/time";
import type { SessionStore } from "../../application/ports";

/** One adapter of `SessionStore` to test. */
export type SessionStoreUnderTest = {
	sessionStore: SessionStore;
	/** Adds a session, as the adapter would find it. */
	addSession(session: {
		id: string;
		personId: string;
		expiresAt: number;
	}): Promise<void>;
	close(): Promise<void>;
};

/** The time of the contract's questions. */
const NOW = parseInstant("2026-11-21T12:00:00Z");

/**
 * What every adapter of `SessionStore` does.
 * `session-store.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function sessionStoreContract(
	name: string,
	make: () => Promise<SessionStoreUnderTest>,
): void {
	describe(`SessionStore contract: ${name}`, () => {
		let under: SessionStoreUnderTest;
		beforeEach(async () => {
			under = await make();
			await under.addSession({
				id: "phone",
				personId: "ada",
				expiresAt: NOW + 60_000,
			});
			await under.addSession({
				id: "old-laptop",
				personId: "ada",
				expiresAt: NOW - 60_000,
			});
		});
		afterEach(async () => {
			await under.close();
		});

		test("a live session has not expired, and exists", async () => {
			expect(
				await under.sessionStore.live(["phone", "old-laptop", "gone"], NOW),
			).toEqual(new Set(["phone"]));
			expect(await under.sessionStore.live([], NOW)).toEqual(new Set());
		});

		test("ends only the Person's own session", async () => {
			expect(await under.sessionStore.end("bob", "phone")).toBe(false);
			expect(await under.sessionStore.live(["phone"], NOW)).toEqual(
				new Set(["phone"]),
			);
			expect(await under.sessionStore.end("ada", "phone")).toBe(true);
			expect(await under.sessionStore.live(["phone"], NOW)).toEqual(new Set());
			expect(await under.sessionStore.end("ada", "phone")).toBe(false);
		});
	});
}
