/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { DevicesOverview } from "@nightshift/client";

import { computersOf } from "./computers";

type Paired = DevicesOverview["devices"][number];

function paired(overrides: Partial<Paired> & { id: string }): Paired {
	return {
		name: overrides.id,
		platform: "darwin",
		ownerId: "p1",
		homeHost: null,
		lastSeenAt: null,
		online: false,
		pairedAt: 1,
		revokedAt: null,
		...overrides,
	};
}

const HOST: NonNullable<DevicesOverview["thisComputer"]> = {
	id: "host",
	name: "studio",
	platform: "linux",
	keyStore: "file",
	host: {
		enabled: true,
		addresses: [],
		reachable: "network",
		restartNeeded: false,
		fingerprint: null,
	},
	hosts: [],
};

describe("computersOf", () => {
	test("lists online computers first, then by name, without removed ones", () => {
		const list = computersOf({
			thisComputer: null,
			devices: [
				paired({ id: "b-off", name: "berry" }),
				paired({ id: "gone", name: "attic", online: true, revokedAt: 5 }),
				paired({ id: "z-on", name: "zebra", online: true }),
				paired({ id: "a-off", name: "apple", lastSeenAt: 9 }),
			],
		});
		expect(list.map((computer) => computer.id)).toEqual([
			"z-on",
			"a-off",
			"b-off",
		]);
		expect(list[1]).toMatchObject({ lastSeenAt: 9, system: "macOS" });
	});

	test("puts the Host first when the person owns it", () => {
		const list = computersOf({
			thisComputer: HOST,
			devices: [paired({ id: "laptop", online: true })],
		});
		expect(list[0]).toEqual({
			id: "host",
			name: "studio",
			system: "Linux",
			online: true,
			lastSeenAt: null,
			isHost: true,
		});
		expect(list[1]?.isHost).toBe(false);
	});
});
