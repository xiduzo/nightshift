import { describe, expect, test } from "bun:test";
import type { OwnDevice } from "@nightshift/engine";
import { flowPlace, type PlaceDeps } from "./place";

const device = (over: Partial<OwnDevice>): OwnDevice =>
	({
		deviceId: "mac",
		name: "MacBook",
		thisDevice: true,
		online: true,
		hasClone: true,
		...over,
	}) as OwnDevice;

function deps(over: Partial<PlaceDeps> = {}): PlaceDeps {
	return {
		space: {
			flows: { map: async () => ({ fix: null, notes: null }) },
			listDevices: async () => [
				device({
					profiles: [
						{
							id: "night",
							name: "night",
							kind: "agent",
							permissionMode: "acceptEdits",
						},
					],
				}),
				// Another Person's Device whose profiles this computer cannot tell.
				device({ deviceId: "studio", name: "Studio", thisDevice: false }),
			],
		},
		cliTools: {
			list: () =>
				[
					{ name: "acli-work", program: "acli", login: { kind: "x" } },
					{ name: "gh", program: null, login: null },
				] as never,
		},
		connections: { list: () => [{ name: "github" }] as never },
		withoutFolder: async () => true,
		...over,
	};
}

describe("flowPlace", () => {
	test("the place has the flows, the Devices with their profiles' modes, the connections, the CLI tools and the folder", async () => {
		const place = await flowPlace(deps(), "p1", "fix");
		expect(place).toMatchObject({
			flows: { fix: null, notes: null },
			name: "fix",
			devices: [
				{
					deviceId: "mac",
					profiles: [{ id: "night", permissionMode: "acceptEdits" }],
				},
				{ deviceId: "studio" },
			],
			connections: ["github"],
			cliTools: [
				{ name: "acli-work", program: "acli", signsIn: true },
				{ name: "gh", program: null, signsIn: false },
			],
			folder: false,
		});
		expect(place.devices?.[1]).not.toHaveProperty("profiles");
	});

	test("a fact that does not load is left out, as in the editor", async () => {
		const place = await flowPlace(
			deps({
				space: {
					flows: {
						map: async () => {
							throw new Error("No such project.");
						},
					},
					listDevices: async () => {
						throw new Error("Sign in to see your devices.");
					},
				},
				withoutFolder: undefined,
			}),
			"p1",
			"fix",
		);
		expect(place.flows).toBeUndefined();
		expect(place.devices).toBeUndefined();
		expect(place.folder).toBeUndefined();
		expect(place.connections).toEqual(["github"]);
	});
});
