import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HostUnreachableError } from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { createEngineOffers } from "./engine-offers";
import { deviceOffers, setDeviceOffer } from "./offers";
import { createOffers } from "./own-offers";

/**
 * This computer's own Offers: withdrawing one, and the Devices of a Space
 * as its Members see them: whose each Device is (from the Host's
 * registry, else from who offered its profiles), and the facts only a
 * Host knows of its paired Devices.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(() => sandbox.cleanup());

const caps = { permissionCap: "acceptEdits" as const, sessionCap: 1 };

function offersWith(paired: Record<string, object>) {
	const engine = {
		space: () => ({
			listProjects: async () => [
				{
					id: "p1",
					name: "zac",
					clones: [
						{ deviceId: "self", deviceName: null, thisDevice: true },
						{ deviceId: "studio", deviceName: "studio", thisDevice: false },
						{ deviceId: "laptop", deviceName: "laptop", thisDevice: false },
					],
				},
			],
		}),
		offers: {
			list: async () => [
				{
					...caps,
					deviceId: "laptop",
					deviceName: "laptop",
					profile: "review",
					offeredAt: 1,
					by: "marieke",
				},
			],
		},
		devices: { get: async (id: string) => paired[id] ?? null },
		members: {
			name: async (_space: string, person: string) =>
				({ me: "Sander", marieke: "Marieke" })[person] ?? null,
		},
	};
	return createOffers({
		db: sandbox.db,
		engine: engine as never,
		document: {} as never,
		profiles: {} as never,
		self: { id: "self", name: "LE2316" },
		ownerId: "me",
		withdrawn: () => {},
	});
}

describe("withdraw", () => {
	test("in a Space a Host keeps, with the Host away: the runs walked here under it stop, then what runs here under it ends", async () => {
		const document = await sandbox.openDocument();
		await setDeviceOffer(document, {
			spaceId: "space-team",
			profile: "coder",
			...caps,
			offeredAt: 1,
		});
		const order: string[] = [];
		const engineOffers = createEngineOffers({
			ready: Promise.resolve(),
			documents: {} as never,
			log: {
				append: async () => {
					throw new Error("A Space a Host keeps logs its Offers there.");
				},
			},
			deviceId: "self",
			now: () => 1,
			hostOf: async () => "host-1",
			relay: {
				offer: async () => {},
				withdrawOffer: async () => {
					order.push("the Host");
					throw new HostUnreachableError();
				},
			},
			stopUnder: async (offer) => {
				order.push(`stop the runs under ${offer.profile}`);
			},
		});
		const offers = createOffers({
			db: sandbox.db,
			engine: { offers: engineOffers } as never,
			document,
			profiles: {} as never,
			self: { id: "self", name: "LE2316" },
			ownerId: "me",
			withdrawn: (_spaceId, profile) => {
				order.push(`abort the calls under ${profile}`);
			},
		});

		await expect(
			offers.withdraw({ spaceId: "space-team", profile: "coder" }, "me"),
		).rejects.toThrow(HostUnreachableError);
		// No more work under it, at once.
		expect(deviceOffers(document)).toEqual([]);
		expect(order).toEqual([
			"the Host",
			"stop the runs under coder",
			"abort the calls under coder",
		]);
		await document.close();
	});
});

describe("spaceDevices", () => {
	test("names each Device's owner and marks the Person's own", async () => {
		const offers = offersWith({
			studio: {
				ownerId: "me",
				platform: "darwin",
				lastSeenAt: 42,
				online: true,
				revokedAt: null,
			},
		});
		const devices = await offers.spaceDevices(sandbox.spaceId, "me");
		const byId = Object.fromEntries(devices.map((d) => [d.id, d]));

		expect(byId.self).toMatchObject({
			thisDevice: true,
			mine: true,
			owner: "Sander",
			online: true,
		});
		// A paired Device: the Host knows its owner, system and last connection.
		expect(byId.studio).toMatchObject({
			mine: true,
			owner: "Sander",
			platform: "darwin",
			lastSeenAt: 42,
			online: true,
		});
		// Another Person's: known only from whom offered its profile.
		expect(byId.laptop).toMatchObject({
			mine: false,
			owner: "Marieke",
			platform: null,
			lastSeenAt: null,
			online: null,
			offers: [{ ...caps, profile: "review" }],
		});
	});

	test("for another Person on this Host, this computer is not theirs", async () => {
		const devices = await offersWith({}).spaceDevices(
			sandbox.spaceId,
			"marieke",
		);
		const byId = Object.fromEntries(devices.map((d) => [d.id, d]));
		expect(byId.self).toMatchObject({
			thisDevice: true,
			mine: false,
			owner: "Sander",
		});
		expect(byId.laptop).toMatchObject({ mine: true, owner: "Marieke" });
	});

	test("a Device the Space knows nothing of its owner is not the Person's", async () => {
		const devices = await offersWith({}).spaceDevices(sandbox.spaceId, "me");
		expect(devices.find((d) => d.id === "studio")).toMatchObject({
			mine: false,
			owner: null,
		});
	});
});
