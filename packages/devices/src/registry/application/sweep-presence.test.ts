import { describe, expect, test } from "bun:test";
import { inMemoryRegistryPorts } from "../adapters/out/in-memory-neighbours";
import { sweepPresence } from "./sweep-presence";

/** The use case sweepPresence, on in-memory adapters. */

describe("sweepPresence", () => {
	test("offline after a silence: DeviceOffline for the silent ones only", async () => {
		const p = inMemoryRegistryPorts();
		p.spaces.add("person-ada");
		p.store.add({ id: "silent", ownerId: "person-ada" });
		p.store.add({ id: "talking", ownerId: "person-ada" });
		p.online.set("silent", p.now());
		p.later(50_000);
		p.online.set("talking", p.now());
		await sweepPresence(p)({ offlineAfterMs: 45_000 });
		expect([...p.online.keys()]).toEqual(["talking"]);
		expect(p.facts.logged.map((l) => l.fact)).toEqual([
			{
				type: "DeviceOffline",
				payload: { deviceId: "silent" },
				spaceId: "personal-person-ada",
			},
		]);
	});

	test("a silent Device without a row goes offline with no fact", async () => {
		const p = inMemoryRegistryPorts();
		p.online.set("gone", p.now());
		p.later(50_000);
		await sweepPresence(p)({ offlineAfterMs: 45_000 });
		expect(p.online.size).toBe(0);
		expect(p.facts.logged).toEqual([]);
	});
});
