import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";

import { testDatabase } from "../testing";
import { createTargetStore, targetView } from "./targets";

let db: Database;
let cleanup: () => void;
beforeEach(async () => {
	({ db, cleanup } = await testDatabase());
});
afterEach(() => cleanup());

test("a screen registers once per endpoint; registering again renames it and marks it seen", async () => {
	let clock = 1_000;
	const store = createTargetStore(db, () => clock);
	const first = await store.register(
		"ada",
		{
			kind: "web",
			name: "Safari",
			endpoint: "https://push.example/abc",
			keys: { p256dh: "key", auth: "secret" },
		},
		"session-1",
	);
	clock = 2_000;
	const again = await store.register("ada", {
		kind: "web",
		name: "Safari on MacBook",
		endpoint: "https://push.example/abc",
		keys: { p256dh: "key", auth: "secret" },
	});

	expect(again.id).toBe(first.id);
	expect(again).toMatchObject({
		name: "Safari on MacBook",
		createdAt: 1_000,
		lastSeenAt: 2_000,
		keys: { p256dh: "key", auth: "secret" },
	});
	expect(await store.of("ada")).toHaveLength(1);
	expect(targetView(again)).toEqual({
		id: first.id,
		kind: "web",
		name: "Safari on MacBook",
		platform: "",
		createdAt: 1_000,
		lastSeenAt: 2_000,
	});
});

test("a Person removes only their own screens", async () => {
	const store = createTargetStore(db);
	const phone = await store.register("ada", {
		kind: "expo",
		name: "Pixel",
		platform: "android",
		endpoint: "ExponentPushToken[abc]",
	});

	expect(await store.remove("bob", phone.id)).toBe(null);
	expect(await store.of("ada")).toHaveLength(1);
	expect((await store.remove("ada", phone.id))?.id).toBe(phone.id);
	expect(await store.of("ada")).toEqual([]);
});
