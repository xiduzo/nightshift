import { describe, expect, test } from "bun:test";
import type { PersonActor } from "@nightshift/engine";
import { inMemoryTargetsPorts } from "../adapters/out/in-memory-neighbours";
import type { NewTarget } from "../domain/push-targets";
import { removeScreen } from "./remove-screen";

/** The use case removeScreen, on in-memory adapters. */

const ADA: PersonActor = { personId: "ada", door: "session" };
const BOB: PersonActor = { personId: "bob", door: "session" };

const target = (id: string, fields: Partial<NewTarget> = {}): NewTarget => ({
	id,
	personId: "ada",
	kind: "expo",
	name: "Pixel",
	platform: "android",
	endpoint: `ExponentPushToken[${id}]`,
	keys: null,
	sessionId: `session-${id}`,
	at: 1_000,
	...fields,
});

describe("removeScreen", () => {
	test("a Person removes only their own screens", async () => {
		const ports = inMemoryTargetsPorts();
		await ports.targetStore.upsert(target("phone"));
		const remove = removeScreen(ports);

		expect(await remove(BOB, { id: "phone" })).toBeNull();
		expect(ports.targetStore.all()).toHaveLength(1);
		expect(ports.sessions.ended).toEqual([]);
		expect((await remove(ADA, { id: "phone" }))?.id).toBe("phone");
		expect(ports.targetStore.all()).toEqual([]);
	});

	test("a phone is signed out; a browser or a phone without a session is not", async () => {
		const ports = inMemoryTargetsPorts();
		await ports.targetStore.upsert(target("phone"));
		await ports.targetStore.upsert(target("bare", { sessionId: null }));
		await ports.targetStore.upsert(
			target("web", { kind: "web", endpoint: "https://web.push.apple.com/a" }),
		);
		const remove = removeScreen(ports);
		for (const id of ["web", "bare", "phone"]) {
			await remove(ADA, { id });
		}
		expect(ports.sessions.ended).toEqual(["ada:session-phone"]);
	});
});
