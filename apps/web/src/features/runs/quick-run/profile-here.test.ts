import { expect, test } from "bun:test";
import { profileHere } from "./profile-here";

const profile = (id: string, name: string, kind: "agent" | "model") => ({
	id,
	name,
	kind,
});

test("a picked profile is this computer's, by its id", () => {
	const devices = [
		{
			deviceId: "far",
			thisDevice: false,
			profiles: [profile("p-far", "builder", "agent")],
		},
		{
			deviceId: "here",
			thisDevice: true,
			profiles: [
				profile("p-model", "builder", "model"),
				profile("p-1", "builder", "agent"),
			],
		},
	];
	expect(profileHere("builder", devices)).toEqual({
		device: "here",
		profile: "p-1",
	});
	expect(profileHere("p-1", devices)).toBeNull();
	expect(profileHere("builder", devices.slice(0, 1))).toBeNull();
	expect(profileHere("builder", [])).toBeNull();
});
