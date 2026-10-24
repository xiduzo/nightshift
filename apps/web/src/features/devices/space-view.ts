import type {
	LinkedHost,
	PairedDevice,
	SpaceDevice,
	ThisComputer,
} from "@/shared/api";

/**
 * The Devices page shows one Space: the Host that keeps it, the Person's
 * computers in it, and the computers of its other Members. This file puts
 * the three reads together (this computer and its Hosts, the Person's
 * paired Devices, the Space's Devices) into that one view.
 */

/** A computer of the Space, with what this computer knows of it. */
export type SpaceComputer = {
	id: string;
	name: string;
	/** Null when this computer cannot tell. */
	platform: string | null;
	/** Null when this computer cannot tell. */
	online: boolean | null;
	lastSeenAt: number | null;
	thisDevice: boolean;
	mine: boolean;
	/** The owner's name in the Space. Null when this computer cannot tell. */
	owner: string | null;
	clones: SpaceDevice["clones"];
	offers: SpaceDevice["offers"];
	/** Paired with this computer as its Host: its owner can remove its access here. */
	paired: PairedDevice | null;
};

/** The Host that keeps the Space. */
export type SpaceHost =
	| {
			kind: "this-computer";
			/** Null for a Person who is not this computer's owner. */
			computer: ThisComputer | null;
	  }
	| { kind: "linked"; host: LinkedHost };

export type SpaceView = {
	host: SpaceHost;
	/** This computer first, then by name. */
	yours: SpaceComputer[];
	/** By owner, then by name. */
	members: SpaceComputer[];
};

export function spaceView(input: {
	spaceId: string;
	/** The Person's personal Space of this computer: every computer they paired is in it. */
	personal: boolean;
	thisComputer: ThisComputer | null;
	/** The Person's Devices paired with this computer, when it is a Host. */
	paired: PairedDevice[];
	devices: SpaceDevice[];
}): SpaceView {
	const linked = input.thisComputer?.hosts.find((host) =>
		host.spaces.some((space) => space.id === input.spaceId),
	);
	const host: SpaceHost = linked
		? { kind: "linked", host: linked }
		: { kind: "this-computer", computer: input.thisComputer };
	const pairedById = new Map(input.paired.map((d) => [d.id, d]));

	const computers = new Map<string, SpaceComputer>();
	for (const device of input.devices) {
		const paired =
			host.kind === "this-computer" ? pairedById.get(device.id) : undefined;
		computers.set(device.id, {
			...device,
			online: paired
				? paired.revokedAt === null && paired.online
				: device.online,
			paired: paired ?? null,
		});
	}
	const self = input.thisComputer;
	if (self && !computers.has(self.id)) {
		computers.set(self.id, {
			id: self.id,
			name: self.name,
			platform: self.platform,
			online: true,
			lastSeenAt: null,
			thisDevice: true,
			mine: true,
			owner: null,
			clones: [],
			offers: [],
			paired: null,
		});
	}
	// Every computer the Person paired with this one is in their personal Space here.
	if (input.personal && host.kind === "this-computer") {
		for (const paired of input.paired) {
			if (computers.has(paired.id)) continue;
			computers.set(paired.id, {
				id: paired.id,
				name: paired.name,
				platform: paired.platform,
				online: paired.revokedAt === null && paired.online,
				lastSeenAt: paired.lastSeenAt,
				thisDevice: false,
				mine: true,
				owner: null,
				clones: [],
				offers: [],
				paired,
			});
		}
	}

	const all = [...computers.values()];
	const byName = (a: SpaceComputer, b: SpaceComputer) =>
		a.name.localeCompare(b.name);
	return {
		host,
		yours: all
			.filter((c) => c.mine)
			.sort(
				(a, b) => Number(b.thisDevice) - Number(a.thisDevice) || byName(a, b),
			),
		members: all
			.filter((c) => !c.mine)
			.sort(
				(a, b) => (a.owner ?? "").localeCompare(b.owner ?? "") || byName(a, b),
			),
	};
}
