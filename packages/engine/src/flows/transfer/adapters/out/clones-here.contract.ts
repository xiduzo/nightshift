import { describe, expect, test } from "bun:test";
import type { ClonesHere } from "../../application/ports";

/** A store with these rows: two Devices, three Projects, one of them removed. */
export type ClonesHereSetup = {
	clones: ClonesHere;
	/** This Device: Clones `first` (Project `one`) and `second` (Project `two`), added in that order, and `gone` (removed Project `three`). */
	deviceId: string;
	/** Another Device, with the Clone `elsewhere` of Project `one`. */
	otherDeviceId: string;
	/** The Space of every Project. */
	spaceId: string;
	close(): Promise<void>;
};

/** What every `ClonesHere` adapter does. */
export function clonesHereContract(
	name: string,
	setup: () => Promise<ClonesHereSetup>,
): void {
	describe(`ClonesHere (${name})`, () => {
		test("lists the Clones of the Device, oldest first, without those of a removed Project", async () => {
			const { clones, deviceId, spaceId, close } = await setup();
			expect(await clones.list(deviceId)).toEqual([
				{
					id: "first",
					projectId: "one",
					spaceId,
					repoPath: "/repos/one",
				},
				{
					id: "second",
					projectId: "two",
					spaceId,
					repoPath: "/repos/two",
				},
			]);
			await close();
		});

		test("lists the Clone of one Project", async () => {
			const { clones, deviceId, close } = await setup();
			expect((await clones.list(deviceId, "two")).map((c) => c.id)).toEqual([
				"second",
			]);
			expect(await clones.list(deviceId, "three")).toEqual([]);
			await close();
		});

		test("lists only the Clones of that Device", async () => {
			const { clones, otherDeviceId, close } = await setup();
			expect((await clones.list(otherDeviceId)).map((c) => c.id)).toEqual([
				"elsewhere",
			]);
			await close();
		});
	});
}
