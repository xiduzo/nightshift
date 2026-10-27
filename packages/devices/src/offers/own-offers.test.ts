import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createProfileStore,
	HostUnreachableError,
	type SpaceDocument,
} from "@nightshift/engine";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import type { AgentProfile } from "@nightshift/flows";
import { createEngineOffers } from "./engine-offers";
import {
	deviceOffers,
	offeredProfile,
	type SpaceOffer,
	setDeviceOffer,
	spaceOffers,
} from "./offers";
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
					profile: "p-review",
					profileName: "review",
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
			documents: {
				open: async () => ({ offers: new Map() }),
			} as never,
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
				order.push(`stop the runs under ${offer.profileName}`);
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
		expect(deviceOffers(document, (id) => id)).toEqual([]);
		expect(order).toEqual([
			"the Host",
			"stop the runs under coder",
			"abort the calls under coder",
		]);
		await document.close();
	});
});

const coder: AgentProfile = {
	name: "coder",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	clis: [],
	connections: [],
};
const { name: _name, ...coderSettings } = coder;

describe("Offers by profile id", () => {
	test("an Offer made before profiles had ids reads unchanged: it names the profile by its name, which is its id", async () => {
		const document = await sandbox.openDocument();
		await document.change(() => {
			document.profiles.set("coder", {
				description: null,
				settings: coderSettings,
				updatedAt: 1,
			});
			document.offers.set("space-team/coder", {
				spaceId: "space-team",
				profile: "coder",
				...caps,
				offeredAt: 1,
			});
		});
		const profiles = createProfileStore({ document });
		const nameOf = (profile: string) =>
			offeredProfile(profiles, profile)?.name ?? null;
		expect(deviceOffers(document, nameOf)).toEqual([
			{
				spaceId: "space-team",
				profile: "coder",
				profileName: "coder",
				...caps,
				offeredAt: 1,
			},
		]);
		const published = new Map([
			[
				"laptop/coder",
				{
					deviceId: "laptop",
					deviceName: "laptop",
					profile: "coder",
					...caps,
					offeredAt: 1,
					by: "marieke",
				},
			],
		]);
		expect(
			spaceOffers({
				offers: published,
			} as unknown as Pick<SpaceDocument, "offers">),
		).toMatchObject([{ profile: "coder", profileName: "coder" }]);
		await document.close();
	});

	test("a renamed profile keeps its Offer, and the Offer of a removed profile is not in force", async () => {
		const document = await sandbox.openDocument();
		const profiles = createProfileStore({ document });
		const saved = await profiles.save(coder);
		await setDeviceOffer(document, {
			spaceId: "space-team",
			profile: saved.id,
			...caps,
			offeredAt: 1,
		});
		const nameOf = (profile: string) =>
			offeredProfile(profiles, profile)?.name ?? null;
		await profiles.save({ ...coder, name: "maker" }, saved.id);
		expect(deviceOffers(document, nameOf)).toMatchObject([
			{ profile: saved.id, profileName: "maker" },
		]);
		await profiles.remove(saved.id);
		// Another profile may take the name of the removed one: it is not offered.
		await profiles.save({ ...coder, name: "maker" });
		expect(deviceOffers(document, nameOf)).toEqual([]);
		await document.close();
	});

	test("a rename shows the new name in each Space that lists the Offer, and not in a Space that withdrew it", async () => {
		const document = await sandbox.openDocument();
		const profiles = createProfileStore({ document });
		const saved = await profiles.save(coder);
		for (const spaceId of ["space-team", "space-gone"]) {
			await setDeviceOffer(document, {
				spaceId,
				profile: saved.id,
				...caps,
				offeredAt: 1,
			});
		}
		const listed: SpaceOffer = {
			...caps,
			deviceId: "self",
			deviceName: "LE2316",
			profile: saved.id,
			profileName: "coder",
			offeredAt: 1,
			by: "me",
		};
		const published: { spaceId: string; profileName: string }[] = [];
		const offers = createOffers({
			db: sandbox.db,
			engine: {
				offers: {
					list: async (spaceId: string) =>
						spaceId === "space-team" ? [listed] : [],
					publish: async (input: { spaceId: string; profileName: string }) => {
						published.push({
							spaceId: input.spaceId,
							profileName: input.profileName,
						});
					},
				},
			} as never,
			document,
			profiles,
			self: { id: "self", name: "LE2316" },
			ownerId: "me",
			withdrawn: () => {},
		});

		await profiles.save({ ...coder, name: "maker" }, saved.id);
		await offers.renamed(saved.id, "me");
		expect(published).toEqual([
			{ spaceId: "space-team", profileName: "maker" },
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
			offers: [{ ...caps, profile: "p-review", profileName: "review" }],
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
