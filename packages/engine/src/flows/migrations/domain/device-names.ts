import type { FlowMigration } from "@nightshift/flows";

/**
 * How a flow of an older format finds a Device and a profile by name
 * (`FlowMigration`), from what this Replica knows of the Devices:
 * - Format 6 → 7 (ADR 3): a node named a profile by its name, and now
 *   names the Device and the profile's id.
 * - Format 7 → 8 (ADR 14): a node named its Device by its name, and now
 *   names it by its id. So does a schedule.
 *
 * It finds a Device by its name as a run found it before ids:
 * the Person's own Devices first, then this computer,
 * then any other Device of the Space. With a Space, a Device counts when
 * the Space document has it, the Person owns it, or it is this computer.
 * A name it does not know, or two Devices of one name in the first rank
 * that has it, find nothing: the node is marked to choose its Device, or
 * its profile, again. It never takes another Device of that name.
 */

/** The Space of a flow or a schedule, and the Person whose Devices come first. */
export type MigrationScope = {
	spaceId: string;
	/** Null or unset: this computer's owner, as a run without a starter. */
	personId?: string | null;
};

/** A profile of a Device, by id and name. */
export type NamedProfile = { id: string; name: string };

/** What this Replica knows of the Devices, in the order it reads it. */
export type DeviceFacts = {
	/** The Device whose profiles the flow's nodes without a `device` took. */
	deviceId: string;
	/** This computer, by the name it has now. */
	self: { id: string; name: string };
	/** The Device documents it keeps or copies: their names and profiles. */
	stored: readonly {
		deviceId: string;
		name: string | null;
		profiles: readonly NamedProfile[];
	}[];
	/** This computer's own profiles, fresher than its stored document. */
	ownProfiles: readonly NamedProfile[] | undefined;
	/** The Device rows: their names and owners. */
	known: readonly { id: string; name: string; ownerId: string | null }[];
	/**
	 * The Devices the Space document names. Undefined: no Space, or no
	 * Space documents to read, so every Device counts.
	 */
	inSpace: readonly { id: string; name: string | null }[] | undefined;
	/** The Person whose Devices come first. Null: none. */
	personId: string | null;
};

/** One Device a name may mean, with every name this Replica knows for it. */
type Candidate = { id: string; names: Set<string>; ownerId: string | null };

/** The migration of a flow whose nodes took their profile from `facts.deviceId`. */
export function flowMigration(facts: DeviceFacts): FlowMigration {
	const { self, personId } = facts;
	const profiles = new Map<string, readonly NamedProfile[]>();
	const candidates = new Map<string, Candidate>();
	const add = (id: string, name: string | null, ownerId?: string | null) => {
		const known = candidates.get(id) ?? {
			id,
			names: new Set<string>(),
			ownerId: null,
		};
		if (name) known.names.add(name);
		if (ownerId) known.ownerId = ownerId;
		candidates.set(id, known);
	};
	for (const device of facts.stored) {
		profiles.set(device.deviceId, device.profiles);
		add(device.deviceId, device.name);
	}
	if (facts.ownProfiles) profiles.set(self.id, facts.ownProfiles);
	for (const row of facts.known) add(row.id, row.name, row.ownerId);
	const inSpace = new Set<string>();
	for (const { id, name } of facts.inSpace ?? []) {
		inSpace.add(id);
		add(id, name);
	}
	// This computer by the name it has now, not an old one.
	const here = candidates.get(self.id);
	add(self.id, self.name);
	if (here) here.names = new Set([self.name]);
	const counts = (c: Candidate) =>
		facts.inSpace === undefined ||
		inSpace.has(c.id) ||
		c.id === self.id ||
		(personId !== null && c.ownerId === personId);
	const all = [...candidates.values()].filter(counts);
	return {
		deviceId: facts.deviceId,
		deviceIdByName(name) {
			const named = all.filter((c) => c.names.has(name));
			// The Person's own first, then this computer, then any other.
			const own = named.filter(
				(c) => personId !== null && c.ownerId === personId,
			);
			const thisOne = named.filter((c) => c.id === self.id);
			const ranked =
				own.length > 0 ? own : thisOne.length > 0 ? thisOne : named;
			return ranked.length === 1 ? (ranked[0] as Candidate).id : null;
		},
		profileIdByName(device, name) {
			const found = (profiles.get(device) ?? []).filter(
				(profile) => profile.name === name,
			);
			return found.length === 1 ? (found[0] as { id: string }).id : null;
		},
	};
}

/** A Space document as this rule reads it: loosely. */
export type SpaceDeviceMaps = {
	devices: { entries(): Iterable<[string, unknown]> };
	offers: { values(): Iterable<unknown> };
};

/**
 * The Devices a Space document names, with a name: those with a Clone
 * (`devices`), and those that offer a profile (`offers`). Read loosely: an
 * entry this version cannot read names no Device.
 */
export function spaceDevices(
	document: SpaceDeviceMaps,
): { id: string; name: string | null }[] {
	const found: { id: string; name: string | null }[] = [];
	for (const [id, value] of document.devices.entries()) {
		found.push({ id, name: stringField(value, "name") });
	}
	for (const value of document.offers.values()) {
		const id = stringField(value, "deviceId");
		if (id) found.push({ id, name: stringField(value, "deviceName") });
	}
	return found;
}

function stringField(value: unknown, field: string): string | null {
	if (typeof value !== "object" || value === null) return null;
	const inner = (value as Record<string, unknown>)[field];
	return typeof inner === "string" && inner !== "" ? inner : null;
}
