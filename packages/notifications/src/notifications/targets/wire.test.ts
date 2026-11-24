import { expect, test } from "bun:test";

import { migratedDb } from "@nightshift/db/testing";
import { wireTargets } from "./wire";

test("findTargets gives the targets of the ids, and no other", async () => {
	const db = await migratedDb();
	const targets = wireTargets({
		db,
		sessions: {} as Parameters<typeof wireTargets>[0]["sessions"],
		clock: () => 1_000,
	});
	const register = (endpoint: string) =>
		targets.registerTarget({
			personId: "ada",
			screen: {
				kind: "web",
				name: "Safari",
				endpoint,
				keys: { p256dh: "key", auth: "secret" },
			},
			sessionId: null,
		});
	const first = await register("https://push.example/a");
	await register("https://push.example/b");
	const found = await targets.findTargets({ ids: [first.id, "nobody"] });
	expect(found.map((target) => target.id)).toEqual([first.id]);
});
