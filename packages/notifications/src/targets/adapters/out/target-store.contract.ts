import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { TargetStore } from "../../application/ports";
import type { NewTarget } from "../../domain/push-targets";

/** One adapter of `TargetStore` to test. */
export type TargetStoreUnderTest = {
	targetStore: TargetStore;
	close(): Promise<void>;
};

const target = (
	id: string,
	personId: string,
	fields: Partial<NewTarget> = {},
): NewTarget => ({
	id,
	personId,
	kind: "web",
	name: "Safari",
	platform: "",
	endpoint: `https://web.push.apple.com/${id}`,
	keys: { p256dh: "key", auth: "secret" },
	sessionId: null,
	at: 1_000,
	...fields,
});

/**
 * What every adapter of `TargetStore` does.
 * `target-store.contract.test.ts` runs it on the in-memory adapter and
 * on the real one.
 */
export function targetStoreContract(
	name: string,
	make: () => Promise<TargetStoreUnderTest>,
): void {
	describe(`TargetStore contract: ${name}`, () => {
		let under: TargetStoreUnderTest;
		let store: TargetStore;
		beforeEach(async () => {
			under = await make();
			store = under.targetStore;
		});
		afterEach(async () => {
			await under.close();
		});

		test("a Person without targets has none, and unknown ids find nothing", async () => {
			expect(await store.of("ada")).toEqual([]);
			expect(await store.byIds([])).toEqual([]);
			expect(await store.byIds(["nobody-has-it"])).toEqual([]);
		});

		test("adds a target and gives it back, oldest first, for its Person only", async () => {
			const later = await store.upsert(target("t2", "ada", { at: 2_000 }));
			const first = await store.upsert(target("t1", "ada"));
			await store.upsert(target("t3", "bob"));
			expect(first).toEqual({
				id: "t1",
				personId: "ada",
				kind: "web",
				name: "Safari",
				platform: "",
				endpoint: "https://web.push.apple.com/t1",
				keys: { p256dh: "key", auth: "secret" },
				sessionId: null,
				createdAt: 1_000,
				lastSeenAt: 1_000,
			});
			expect(await store.of("ada")).toEqual(
				[first, later].flatMap((kept) => (kept ? [kept] : [])),
			);
			expect(later?.id).toBe("t2");
			expect((await store.byIds(["t3", "t9"])).map((t) => t.id)).toEqual([
				"t3",
			]);
		});

		test("one target per endpoint of a Person: a second one renames it and marks it seen", async () => {
			await store.upsert(target("t1", "ada", { sessionId: "s1" }));
			const again = await store.upsert(
				target("t2", "ada", {
					endpoint: "https://web.push.apple.com/t1",
					name: "Safari on MacBook",
					keys: null,
					at: 2_000,
				}),
			);
			expect(again).toMatchObject({
				id: "t1",
				name: "Safari on MacBook",
				keys: null,
				sessionId: null,
				createdAt: 1_000,
				lastSeenAt: 2_000,
			});
			expect(await store.of("ada")).toHaveLength(1);
		});

		test("drops a phone token of every other Person, and nothing else", async () => {
			const phone = { kind: "expo" as const, endpoint: "ExponentPushToken[x]" };
			await store.upsert(target("ada-phone", "ada", phone));
			await store.upsert(target("bob-phone", "bob", phone));
			await store.upsert(
				target("cy-web", "cy", { endpoint: "ExponentPushToken[x]" }),
			);
			await store.dropPhoneOfOthers("bob", "ExponentPushToken[x]");
			expect(await store.of("ada")).toEqual([]);
			expect((await store.of("bob")).map((t) => t.id)).toEqual(["bob-phone"]);
			expect((await store.of("cy")).map((t) => t.id)).toEqual(["cy-web"]);
		});

		test("a Person removes only their own targets", async () => {
			await store.upsert(target("t1", "ada"));
			expect(await store.remove("bob", "t1")).toBeNull();
			expect((await store.remove("ada", "t1"))?.id).toBe("t1");
			expect(await store.of("ada")).toEqual([]);
			expect(await store.remove("ada", "t1")).toBeNull();
		});

		test("forgets these targets", async () => {
			await store.upsert(target("t1", "ada"));
			await store.upsert(target("t2", "ada"));
			await store.upsert(target("t3", "ada"));
			await store.forget([]);
			await store.forget(["t1", "t3"]);
			expect((await store.of("ada")).map((t) => t.id)).toEqual(["t2"]);
		});
	});
}
