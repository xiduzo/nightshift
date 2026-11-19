import { afterEach, describe, expect, test } from "bun:test";
import type { OwnDevice, PersonActor } from "../../../../contract";
import type { RunRow } from "../../../../log";
import type { MoveDevices } from "../../application/ports";

/** A Device of the suite: whose it is, and what it says it walks. */
export type SuiteDevice = OwnDevice & {
	personId: string;
	flowVersion?: number;
	testRuns?: boolean;
};

/** One adapter of `MoveDevices` to test. */
export type MoveDevicesUnderTest = {
	devices: MoveDevices;
	/** The Devices the planner knows. */
	add(devices: readonly SuiteDevice[]): Promise<void>;
	close(): Promise<void>;
};

const ADA: PersonActor = { personId: "person-ada" };
const BEA = "person-bea";

/** The run the suite moves: walked by this computer, in Space `space-1`. */
const RUN = {
	id: "run-1",
	spaceId: "space-1",
	projectId: "project-1",
	walkerId: "here",
	flow: "{}",
	bodyFlows: "{}",
	deviceId: null,
	placements: null,
	deviceNames: null,
	startedBy: ADA.personId,
	fallbacks: null,
} as unknown as RunRow;

const device = (
	deviceId: string,
	fields: Partial<SuiteDevice> = {},
): SuiteDevice => ({
	deviceId,
	name: deviceId,
	thisDevice: false,
	online: true,
	hasClone: true,
	personId: ADA.personId,
	...fields,
});

/**
 * What every adapter of `MoveDevices` does. `move-devices.contract.test.ts`
 * runs it on the in-memory adapter and on the one over the planner of the
 * peers (`PlacementPort`).
 */
export function moveDevicesContract(
	name: string,
	make: () => Promise<MoveDevicesUnderTest>,
): void {
	describe(`MoveDevices contract: ${name}`, () => {
		let under: MoveDevicesUnderTest | null = null;
		afterEach(async () => {
			await under?.close();
			under = null;
		});

		test("a target is one of the Person's own Devices, online", async () => {
			under = await make();
			await under.add([device("laptop")]);
			expect(await under.devices.target(RUN, ADA, "laptop")).toEqual({
				id: "laptop",
				name: "laptop",
			});
		});

		test("another Person's Device, an unknown one and this computer are none", async () => {
			under = await make();
			await under.add([
				device("here", { thisDevice: true }),
				device("theirs", { personId: BEA }),
			]);
			expect(await under.devices.target(RUN, ADA, "theirs")).toBeNull();
			expect(await under.devices.target(RUN, ADA, "nowhere")).toBeNull();
			expect(await under.devices.target(RUN, ADA, "here")).toBeNull();
		});

		test("an offline Device is the planner's refusal", async () => {
			under = await make();
			await under.add([device("laptop", { online: false })]);
			await expect(
				under.devices.target(RUN, ADA, "laptop"),
			).rejects.toMatchObject({
				kind: "unavailable",
				message: "laptop is offline. Move the run when it is online.",
			});
		});

		test("a target says what it walks, and one that does not say reads format 8 and no test runs", async () => {
			under = await make();
			await under.add([
				device("laptop", { flowVersion: 10, testRuns: true }),
				device("old"),
			]);
			expect(
				await under.devices.capabilities({ id: "laptop", name: "laptop" }, RUN),
			).toEqual({ flowVersion: 10, testRuns: true });
			expect(
				await under.devices.capabilities({ id: "old", name: "old" }, RUN),
			).toEqual({ flowVersion: 8, testRuns: false });
		});

		test("the Person's own Devices are listed online and offline", async () => {
			under = await make();
			await under.add([
				device("here", { thisDevice: true }),
				device("laptop"),
				device("desk", { online: false }),
			]);
			const own = await under.devices.own(RUN, ADA);
			expect(own.map((d) => [d.deviceId, d.online]).sort()).toEqual(
				[
					["desk", false],
					["here", true],
					["laptop", true],
				].sort(),
			);
		});
	});
}
