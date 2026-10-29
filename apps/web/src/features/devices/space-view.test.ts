import { describe, expect, test } from "bun:test";
import type {
	LinkedHost,
	PairedDevice,
	SpaceDevice,
	ThisComputer,
} from "@/shared/api";
import { spaceView } from "./space-view";

const thisComputer = (hosts: LinkedHost[] = []): ThisComputer => ({
	id: "self",
	name: "LE2316",
	platform: "darwin",
	keyStore: "keychain",
	host: {
		enabled: true,
		addresses: [],
		reachable: "network",
		restartNeeded: false,
		fingerprint: null,
	},
	hosts,
});

const linked = (spaces: string[]): LinkedHost => ({
	hostId: "host-1",
	name: "infonl-studio",
	role: "guest",
	homeHost: false,
	addresses: ["https://studio.example.com"],
	address: null,
	status: "online",
	since: 0,
	fingerprint: null,
	spaces: spaces.map((id) => ({ id, name: id, personal: false })),
});

const paired = (
	id: string,
	extra: Partial<PairedDevice> = {},
): PairedDevice => ({
	id,
	name: id,
	platform: "linux",
	ownerId: "me",
	homeHost: null,
	lastSeenAt: 5,
	online: true,
	pairedAt: 1,
	revokedAt: null,
	...extra,
});

const device = (id: string, extra: Partial<SpaceDevice> = {}): SpaceDevice => ({
	id,
	name: id,
	online: null,
	thisDevice: false,
	mine: false,
	owner: null,
	platform: null,
	lastSeenAt: null,
	clones: [],
	offers: [],
	...extra,
});

describe("spaceView", () => {
	test("a Space this computer keeps: it is the Host, and the personal Space has every paired computer", () => {
		const view = spaceView({
			spaceId: "personal",
			personal: true,
			thisComputer: thisComputer(),
			paired: [paired("studio"), paired("hetzner-1", { online: false })],
			devices: [device("self", { thisDevice: true, mine: true })],
		});
		expect(view.host.kind).toBe("this-computer");
		expect(view.yours.map((c) => c.id)).toEqual([
			"self",
			"hetzner-1",
			"studio",
		]);
		expect(view.yours.find((c) => c.id === "hetzner-1")?.online).toBe(false);
		expect(view.yours.find((c) => c.id === "studio")?.paired?.id).toBe(
			"studio",
		);
		expect(view.members).toEqual([]);
	});

	test("a shared Space a Host keeps: that Host, and the members' computers by owner", () => {
		const view = spaceView({
			spaceId: "team",
			personal: false,
			thisComputer: thisComputer([linked(["team"])]),
			paired: [paired("studio")],
			devices: [
				device("self", { thisDevice: true, mine: true }),
				device("ruben-xps", { owner: "Ruben" }),
				device("marieke-mbp", { owner: "Marieke" }),
			],
		});
		expect(view.host).toMatchObject({
			kind: "linked",
			host: { name: "infonl-studio" },
		});
		// A computer paired here is not in a Space another Host keeps.
		expect(view.yours.map((c) => c.id)).toEqual(["self"]);
		expect(view.members.map((c) => c.id)).toEqual(["marieke-mbp", "ruben-xps"]);
	});

	test("this computer is in the Space even with no project copy in it", () => {
		const view = spaceView({
			spaceId: "team",
			personal: false,
			thisComputer: thisComputer(),
			paired: [],
			devices: [],
		});
		expect(view.yours).toMatchObject([
			{ id: "self", thisDevice: true, online: true },
		]);
	});
});
