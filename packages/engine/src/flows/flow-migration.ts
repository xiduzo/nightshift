import type { Database } from "@nightshift/db";
import type { FlowMigration } from "@nightshift/flows";
import type { DeviceDirectory } from "../contract";
import { type ProfileStore, storedDevices } from "../device-config";
import type { SpaceDocuments } from "../projects";

/**
 * What brings a flow of an older format to the current one on this
 * Replica, and a schedule from before ids (`FlowMigration`):
 * - Format 6 → 7 (ADR 3): a node named a profile by its name, and now
 *   names the Device and the profile's id.
 * - Format 7 → 8 (ADR 14): a node named its Device by its name, and now
 *   names it by its id. So does a schedule.
 *
 * `forDevice` gives the migration of a flow whose nodes without a
 * `device` took their profile from that Device: the Device that saved the
 * flow's last revision, or the one that imports it. `scope` is the Space
 * of the flow and the Person who saved it.
 *
 * It finds a Device by its name as a run found it before ids:
 * the Person's own Devices first, then this computer,
 * then any other Device of the Space. It knows the Device rows of this
 * Replica (`DeviceDirectory.known`: on a Host, every paired Device), the
 * Devices and Offers of the Space document, and the Device documents it
 * keeps or copies (`storedDevices`). With a Space, a Device counts when the
 * Space document has it, the Person owns it, or it is this computer. A
 * name it does not know, or two Devices of one name in the first rank
 * that has it, find nothing: the node is marked to choose its Device, or
 * its profile, again. It never takes another Device of that name.
 */
export type FlowMigrations = {
	forDevice(deviceId: string, scope?: MigrationScope): Promise<FlowMigration>;
};

/** The Space of a flow or a schedule, and the Person whose Devices come first. */
export type MigrationScope = {
	spaceId: string;
	/** Null or unset: this computer's owner, as a run without a starter. */
	personId?: string | null;
};

/** One Device a name may mean, with every name this Replica knows for it. */
type Candidate = { id: string; names: Set<string>; ownerId: string | null };

export function createFlowMigrations(deps: {
	db: Database;
	/** This Device. */
	device(): Promise<{ id: string; name: string }>;
	/** This Device's profiles, fresher than its stored document. */
	profiles?: Pick<ProfileStore, "list"> | undefined;
	/** The Device rows: their names and owners. Without it, only the documents. */
	directory?: Pick<DeviceDirectory, "known" | "selfOwnerId"> | undefined;
	/** The Space documents: the Devices and Offers of a Space. */
	spaces?: Pick<SpaceDocuments, "open"> | undefined;
}): FlowMigrations {
	return {
		async forDevice(deviceId, scope) {
			const self = await deps.device();
			const profiles = new Map<string, { id: string; name: string }[]>();
			const candidates = new Map<string, Candidate>();
			const add = (
				id: string,
				name: string | null,
				ownerId?: string | null,
			) => {
				const known = candidates.get(id) ?? {
					id,
					names: new Set<string>(),
					ownerId: null,
				};
				if (name) known.names.add(name);
				if (ownerId) known.ownerId = ownerId;
				candidates.set(id, known);
			};
			for (const device of await storedDevices(deps.db)) {
				profiles.set(device.deviceId, device.profiles);
				add(device.deviceId, device.name);
			}
			if (deps.profiles) profiles.set(self.id, deps.profiles.list());
			for (const row of (await deps.directory?.known()) ?? []) {
				add(row.id, row.name, row.ownerId);
			}
			const inSpace = new Set<string>();
			if (scope && deps.spaces) {
				for (const { id, name } of spaceDevices(
					await deps.spaces.open(scope.spaceId),
				)) {
					inSpace.add(id);
					add(id, name);
				}
			}
			// This computer by the name it has now, not an old one.
			const here = candidates.get(self.id);
			add(self.id, self.name);
			if (here) here.names = new Set([self.name]);
			const personId =
				scope === undefined
					? null
					: (scope.personId ?? (await deps.directory?.selfOwnerId()) ?? null);
			const counts = (c: Candidate) =>
				scope === undefined ||
				!deps.spaces ||
				inSpace.has(c.id) ||
				c.id === self.id ||
				(personId !== null && c.ownerId === personId);
			const all = [...candidates.values()].filter(counts);
			return {
				deviceId,
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
		},
	};
}

/**
 * The Devices a Space document names, with a name: those with a Clone
 * (`devices`), and those that offer a profile (`offers`). Read loosely: an
 * entry this version cannot read names no Device.
 */
function spaceDevices(document: {
	devices: { entries(): Iterable<[string, unknown]> };
	offers: { values(): Iterable<unknown> };
}): { id: string; name: string | null }[] {
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
