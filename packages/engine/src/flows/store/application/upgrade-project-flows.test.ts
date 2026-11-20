import { describe, expect, test } from "bun:test";
import { inMemoryStorePorts } from "../adapters/out/in-memory-neighbours";
import { upgradeProjectFlows } from "./upgrade-project-flows";

describe("upgradeProjectFlows", () => {
	test("upgrades each Project whose Space this Replica keeps, as this Device, and leaves out one that is gone", async () => {
		const ports = inMemoryStorePorts();
		ports.store.seed("hosted");
		ports.store.seed("gone");
		ports.projects.set("hosted", "elsewhere");
		await upgradeProjectFlows(ports)({
			keeps: async (spaceId) => spaceId === "space",
		});
		expect(ports.store.upgraded).toEqual([
			{ projectId: "project", deviceId: "laptop", spaceId: "space" },
		]);
	});
});
