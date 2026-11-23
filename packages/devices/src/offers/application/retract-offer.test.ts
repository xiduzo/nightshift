import { expect, test } from "bun:test";
import { retractOffer } from "./retract-offer";

function document(seed?: unknown) {
	const offers = new Map<string, unknown>();
	if (seed) offers.set("self/coder", seed);
	return {
		offers,
		async change(fn: () => void) {
			fn();
		},
	};
}

const listed = {
	deviceId: "self",
	deviceName: "This computer",
	profile: "coder",
	profileName: "maker",
	permissionCap: "default",
	sessionCap: 1,
	offeredAt: 1,
	by: "ada",
};

test("a Host withdraw stops the runs here even when the Host cannot be reached", async () => {
	const order: string[] = [];
	await expect(
		retractOffer({
			ready: Promise.resolve(),
			open: async () => document(listed),
			hostOf: async () => "host",
			deviceId: "self",
			relay: {
				withdrawOffer: async () => {
					order.push("the Host");
					throw new Error("The Host cannot be reached.");
				},
			},
			logWithdrawn: async () => {},
			stopUnder: async () => {
				order.push("stop the runs under coder");
			},
			unreachable: () => {
				throw new Error("unreachable");
			},
		})({ spaceId: "team", deviceId: "self", profile: "coder", by: "ada" }),
	).rejects.toThrow("The Host cannot be reached.");
	expect(order).toEqual(["the Host", "stop the runs under coder"]);
});

test("a local withdraw logs only when the Offer was listed", async () => {
	const doc = document(listed);
	const logged: string[] = [];
	const stopped: string[] = [];
	await retractOffer({
		ready: Promise.resolve(),
		open: async () => doc,
		hostOf: async () => null,
		deviceId: "self",
		logWithdrawn: async () => {
			logged.push("OfferWithdrawn");
		},
		stopUnder: async (offer) => {
			stopped.push(offer.profileName);
		},
		unreachable: () => {
			throw new Error("unreachable");
		},
	})({ spaceId: "team", deviceId: "self", profile: "coder", by: "ada" });
	expect(doc.offers.has("self/coder")).toBe(false);
	expect(logged).toEqual(["OfferWithdrawn"]);
	expect(stopped).toEqual(["maker"]);
});
