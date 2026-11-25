import { expect, test } from "bun:test";
import { HostUnreachableError } from "@nightshift/engine";
import { hostDevicesContract } from "./host-devices.contract";
import { inMemoryHostDevices } from "./in-memory-host-devices";
import { relayHostDevices } from "./relay-host-devices";

hostDevicesContract("in memory", inMemoryHostDevices);
hostDevicesContract("over the relay", (host) =>
	relayHostDevices({
		devices: async () => {
			if (host.refuses) throw host.refuses;
			if (host.unreachable) throw new HostUnreachableError();
			return host.devices ?? [];
		},
	}),
);

test("a fetch that fails is a Host that cannot be reached", async () => {
	const host = relayHostDevices({
		devices: async () => {
			throw new Error("The socket closed.");
		},
	});
	expect(await host.list({ spaceId: "s", projectId: "p" })).toBeNull();
});

test("a computer without Links has no Devices of a Host", async () => {
	const host = relayHostDevices(null);
	expect(await host.list({ spaceId: "s", projectId: "p" })).toEqual([]);
});

test("the Host is asked for the project of the Space", async () => {
	const asked: unknown[] = [];
	const host = relayHostDevices({
		devices: async (project) => {
			asked.push(project);
			return [];
		},
	});
	await host.list({ spaceId: "s", projectId: "p" });
	expect(asked).toEqual([{ spaceId: "s", projectId: "p" }]);
});
