import { beforeEach, describe, expect, test } from "bun:test";
import { migratedDb } from "@nightshift/db/testing";
import { parseInstant } from "@nightshift/time";
import { sessionSeed } from "../../test-support";
import { drizzleSessionStore } from "./drizzle-session-store";

/** The time of the questions. */
const NOW = parseInstant("2026-11-21T12:00:00Z");

const make = async () => {
	const db = await migratedDb();
	return {
		sessionStore: drizzleSessionStore(db),
		addSession: sessionSeed(db),
	};
};

describe("SessionStore over drizzle", () => {
	let under: Awaited<ReturnType<typeof make>>;
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
