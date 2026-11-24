import { describe, expect, test } from "bun:test";
import type { NewTarget } from "../domain/push-targets";
import { targetsPorts } from "../test-support";
import { listTargets } from "./list-targets";

/** The use case listTargets, over a database in memory. */

const phone = (id: string, sessionId: string | null): NewTarget => ({
	id,
	personId: "ada",
	kind: "expo",
	name: "Team phone",
	platform: "",
	endpoint: `ExponentPushToken[${id}]`,
	keys: null,
	sessionId,
	at: 1_000,
});

describe("listTargets", () => {
	test("a phone gets nothing more once its session ended: signed out, expired or revoked", async () => {
		const ports = await targetsPorts();
		ports.time = 5_000;
		ports.sessions.add("live", "ada", 10_000);
		ports.sessions.add("expired", "ada", 4_000);
		await ports.targetStore.upsert(phone("kept", "live"));
		await ports.targetStore.upsert(phone("expired", "expired"));
		await ports.targetStore.upsert(phone("signed-out", "signed-out"));
		// A browser's target does not end with its session.
		await ports.targetStore.upsert({
			...phone("browser", "signed-out"),
			kind: "web",
			endpoint: "https://web.push.apple.com/abc",
		});

		const listed = await listTargets(ports)({ personId: "ada" });
		expect(listed.map((t) => t.id)).toEqual(["kept", "browser"]);
		// Forgotten, not only left out.
		expect((await ports.allTargets()).map((t) => t.id)).toEqual([
			"kept",
			"browser",
		]);
	});

	test("without phones, or with every phone live, it forgets nothing", async () => {
		const ports = await targetsPorts();
		ports.sessions.add("live", "ada", 10_000);
		await ports.targetStore.upsert(phone("kept", "live"));
		await ports.targetStore.upsert(phone("bare", null));
		expect(
			(await listTargets(ports)({ personId: "ada" })).map((t) => t.id),
		).toEqual(["kept", "bare"]);
		expect(await listTargets(ports)({ personId: "bob" })).toEqual([]);
	});
});
