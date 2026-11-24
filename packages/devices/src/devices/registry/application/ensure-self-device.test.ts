import { describe, expect, test } from "bun:test";
import { inMemoryThisComputer } from "../adapters/out/in-memory-neighbours";
import { registryPorts } from "../test-support";
import { ensureSelfDevice } from "./ensure-self-device";

/** The use case ensureSelfDevice, over a database in memory. */

const host = { name: "studio", platform: "linux" };

describe("ensureSelfDevice", () => {
	test("one row is this computer, with the same id on every call", async () => {
		const p = await registryPorts();
		const ensure = ensureSelfDevice(p);
		const first = await ensure({ host });
		expect(first).toEqual({ id: "id-1", name: "studio" });
		expect(await ensure({ host })).toEqual(first);
		expect(await p.rowIds()).toHaveLength(1);
	});

	test("a name the person gave stays; a blank one is the host name", async () => {
		const p = await registryPorts();
		await p.add({ id: "self", self: true, name: "", platform: "" });
		expect(await ensureSelfDevice(p)({ host })).toEqual({
			id: "self",
			name: "studio",
		});
		expect((await p.store.self())?.platform).toBe("linux");
		await p.store.setFacts("self", { name: "Mine" });
		expect((await ensureSelfDevice(p)({ host })).name).toBe("Mine");
	});

	test("a stale default name becomes the new default; a chosen one stays", async () => {
		const p = await registryPorts();
		await p.add({ id: "self", self: true, name: "old", platform: "linux" });
		const stale = { ...host, stale: (name: string) => name === "old" };
		expect((await ensureSelfDevice(p)({ host: stale })).name).toBe("studio");
		await p.store.setFacts("self", { name: "Mine" });
		expect((await ensureSelfDevice(p)({ host: stale })).name).toBe("Mine");
	});

	test("without a host, the default of this computer: the host name, (dev) for a dev install", async () => {
		const p = {
			...(await registryPorts()),
			computer: inMemoryThisComputer({ hostName: "studio.local" }),
		};
		expect((await ensureSelfDevice(p)({ dev: true })).name).toBe(
			"studio (dev)",
		);
	});
});
