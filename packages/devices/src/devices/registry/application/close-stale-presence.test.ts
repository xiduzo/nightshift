import { describe, expect, test } from "bun:test";
import { registryPorts } from "../test-support";
import { closeStalePresence } from "./close-stale-presence";

/** The use case closeStalePresence, over a database in memory. */

describe("closeStalePresence", () => {
	test("a Host that starts again starts with every Device offline", async () => {
		const p = await registryPorts();
		p.spaces.add("person-ada");
		await p.add({ id: "was-online", ownerId: "person-ada" });
		await p.add({ id: "was-offline", ownerId: "person-ada" });
		p.history.presence.set("was-online", "DeviceOnline");
		p.history.presence.set("was-offline", "DeviceOffline");
		await closeStalePresence(p)();
		expect(p.facts.logged.map((l) => l.fact)).toEqual([
			{
				type: "DeviceOffline",
				payload: { deviceId: "was-online" },
				spaceId: "personal-person-ada",
			},
		]);
	});

	test("a reload is no new start: a Device handed over as online stays online", async () => {
		const p = await registryPorts();
		p.spaces.add("person-ada");
		await p.add({ id: "b", ownerId: "person-ada" });
		p.history.presence.set("b", "DeviceOnline");
		p.online.set("b", 1);
		await closeStalePresence(p)();
		expect(p.facts.logged).toEqual([]);
	});
});
