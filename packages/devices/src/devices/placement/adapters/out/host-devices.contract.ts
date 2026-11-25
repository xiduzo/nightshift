import { describe, expect, test } from "bun:test";
import type { OwnDevice } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import type { HostDevices } from "../../application/ports";

const LAPTOP: OwnDevice = {
	deviceId: "laptop",
	name: "Laptop",
	thisDevice: false,
	online: true,
	hasClone: true,
};

/** What every adapter of the Devices a Host lists does. */
export function hostDevicesContract(
	name: string,
	make: (host: {
		devices?: OwnDevice[];
		refuses?: Error;
		unreachable?: boolean;
	}) => HostDevices,
): void {
	const list = (host: Parameters<typeof make>[0]) =>
		make(host).list({ spaceId: "s", projectId: "p" });

	describe(`the Devices a Host lists: ${name}`, () => {
		test("are the ones it gives", async () => {
			expect(await list({ devices: [LAPTOP] })).toEqual([LAPTOP]);
		});

		test("a refusal of the Host stands", async () => {
			const refuses = new Refusal("forbidden", "Not yours.");
			await expect(list({ refuses })).rejects.toBe(refuses);
		});

		test("are unknown while it cannot be reached", async () => {
			expect(await list({ unreachable: true })).toBeNull();
		});
	});
}
