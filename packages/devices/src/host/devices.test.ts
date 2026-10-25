import { describe, expect, test } from "bun:test";
import type { HostClient, PhoneView } from "../contract";
import { createDevices } from "./devices";

/** This computer's Devices, with a link to one Host that lists `phones`, and a clock. */
function devicesWith(listed: PhoneView[]) {
	let phones = listed;
	const calls = { phones: 0, removes: 0 };
	let clock = 0;
	const client = {
		link: {
			phones: async () => {
				calls.phones++;
				return [...phones];
			},
			removePhone: async ({ id }: { id: string }) => {
				calls.removes++;
				phones = phones.filter((p) => p.id !== id);
			},
		},
	} as unknown as HostClient;
	const devices = createDevices({
		links: {
			get: (hostId: string) =>
				hostId === "h1"
					? { call: (use: (c: HostClient) => unknown) => use(client) }
					: undefined,
		},
		now: () => clock,
	} as unknown as Parameters<typeof createDevices>[0]);
	return {
		devices,
		calls,
		later: (ms: number) => {
			clock += ms;
		},
	};
}

const phone = (id: string): PhoneView => ({
	id,
	name: `Phone ${id}`,
	platform: "ios",
	createdAt: 0,
	lastSeenAt: null,
});

describe("the phones on a Host this computer joined", () => {
	test("are asked of the Host at most every 30 seconds", async () => {
		const { devices, calls, later } = devicesWith([phone("p1")]);
		expect(await devices.phonesAt("h1")).toEqual([phone("p1")]);
		later(10_000);
		expect(await devices.phonesAt("h1")).toEqual([phone("p1")]);
		expect(calls.phones).toBe(1);
		later(25_000);
		await devices.phonesAt("h1");
		expect(calls.phones).toBe(2);
	});

	test("are asked again once one is signed out", async () => {
		const { devices, calls } = devicesWith([phone("p1"), phone("p2")]);
		await devices.phonesAt("h1");
		await devices.removePhoneAt("h1", "p1");
		expect(await devices.phonesAt("h1")).toEqual([phone("p2")]);
		expect(calls).toEqual({ phones: 2, removes: 1 });
	});

	test("are asked again when the Host did not answer", async () => {
		const { devices } = devicesWith([]);
		await expect(devices.phonesAt("h2")).rejects.toThrow();
		await expect(devices.phonesAt("h2")).rejects.toThrow();
	});
});
