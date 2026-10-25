import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { createOffers } from "./own-offers";

/**
 * The Devices of a Space as its Members see them: whose each Device is
 * (from the Host's registry, else from who offered its profiles), and the
 * facts only a Host knows of its paired Devices.
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
