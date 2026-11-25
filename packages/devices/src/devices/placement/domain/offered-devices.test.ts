import { expect, test } from "bun:test";
import { offered, offeringDevices, standsOffered } from "./offered-devices";

const offer = (deviceId: string, profileName: string) => ({
	deviceId,
	deviceName: `published ${deviceId}`,
	profile: `p-${profileName}`,
	profileName,
});
const choice = (name: string) => ({
	id: `p-${name}`,
	name,
	kind: "agent" as const,
});

test("Offers give their profiles: the name a flow uses, and the choice of a Person", () => {
	expect(offered([offer("a", "coder")])).toEqual({
		offers: ["coder"],
		profiles: [choice("coder")],
	});
});

test("an offering Device comes once with all its profiles, and a known one never", () => {
	expect(
		offeringDevices(
			[
				offer("a", "coder"),
				offer("own", "x"),
				offer("b", "y"),
				offer("a", "z"),
			],
			new Set(["own"]),
		),
	).toEqual([
		{
			deviceId: "a",
			name: "published a",
			offers: ["coder", "z"],
			profiles: [choice("coder"), choice("z")],
		},
		{
			deviceId: "b",
			name: "published b",
			offers: ["y"],
			profiles: [choice("y")],
		},
	]);
});

test("an offering Device stands when it never paired here, or is another Person's with access", () => {
	const paired = (ownerId: string, revokedAt: number | null = null) => ({
		ownerId,
		revokedAt,
	});
	expect(standsOffered(null, "ada")).toBe(true);
	expect(standsOffered(paired("bob"), "ada")).toBe(true);
	expect(standsOffered(paired("bob", 1), "ada")).toBe(false);
	expect(standsOffered(paired("ada"), "ada")).toBe(false);
});
