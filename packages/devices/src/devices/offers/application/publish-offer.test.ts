import { expect, test } from "bun:test";
import { publishOffer } from "./publish-offer";

function document() {
	const offers = new Map<string, unknown>();
	return {
		offers,
		async change(fn: () => void) {
			fn();
		},
	};
}

const input = {
	spaceId: "team",
	deviceId: "self",
	deviceName: "This computer",
	profile: "coder",
	profileName: "Coder",
	permissionCap: "default" as const,
	sessionCap: 1,
	by: "ada" as string | null,
};

test("writes the Offer in a Space this computer keeps and logs it", async () => {
	const doc = document();
	const logged: string[] = [];
	await publishOffer({
		ready: Promise.resolve(),
		open: async () => doc,
		hostOf: async () => null,
		deviceId: "self",
		now: () => 40,
		logMade: async () => {
			logged.push("OfferMade");
		},
		unreachable: () => {
			throw new Error("unreachable");
		},
	})(input);
	expect(doc.offers.get("self/coder")).toMatchObject({
		profileName: "Coder",
		offeredAt: 40,
		by: "ada",
	});
	expect(logged).toEqual(["OfferMade"]);
});

test("a Space a Host keeps goes through the Host, and not into the local document", async () => {
	const doc = document();
	const sent: string[] = [];
	await publishOffer({
		ready: Promise.resolve(),
		open: async () => doc,
		hostOf: async () => "host",
		deviceId: "self",
		now: () => 40,
		relay: {
			offer: async (offer) => {
				sent.push(offer.profileName);
			},
		},
		logMade: async () => {},
		unreachable: () => {
			throw new Error("unreachable");
		},
	})(input);
	expect(sent).toEqual(["Coder"]);
	expect(doc.offers.size).toBe(0);
});

test("another Device's Offer cannot be published through the Host", async () => {
	await expect(
		publishOffer({
			ready: Promise.resolve(),
			open: async () => document(),
			hostOf: async () => "host",
			deviceId: "self",
			now: () => 1,
			relay: { offer: async () => {} },
			logMade: async () => {},
			unreachable: () => {
				throw new Error("The Host cannot be reached.");
			},
		})({ ...input, deviceId: "other" }),
	).rejects.toThrow("The Host cannot be reached.");
});
