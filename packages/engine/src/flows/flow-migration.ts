import type { Database } from "@nightshift/db";
import type { FlowMigration } from "@nightshift/flows";
import { type ProfileStore, storedDevices } from "../device-config";

/**
 * What brings a flow of format 6 to format 7 on this Replica (ADR 3): a
 * node named a profile by its name, and now names the Device and the
 * profile's id (`FlowMigration`). `forDevice` gives the migration of a
 * flow whose nodes without a `device` took their profile from that Device:
 * the Device that saved the flow's last revision, or the one that imports
 * it.
 *
 * It finds a Device by name, and a profile of a Device by name, in what
 * this Replica knows: this Device's own profiles, and the Device documents
 * it keeps or copies (`storedDevices`). A name it does not know, or two
 * Devices of one name, find nothing: the node is marked to pick its
 * profile again. It never takes another Device's profile of that name.
 */
export type FlowMigrations = {
	forDevice(deviceId: string): Promise<FlowMigration>;
};

export function createFlowMigrations(deps: {
	db: Database;
	/** This Device. */
	device(): Promise<{ id: string; name: string }>;
	/** This Device's profiles, fresher than its stored document. */
	profiles?: Pick<ProfileStore, "list"> | undefined;
}): FlowMigrations {
	return {
		async forDevice(deviceId) {
			const self = await deps.device();
			const profiles = new Map<string, { id: string; name: string }[]>();
			const ids = new Map<string, string[]>();
			const named = (name: string | null, id: string) => {
				if (name === null) return;
				const known = ids.get(name) ?? [];
				if (!known.includes(id)) ids.set(name, [...known, id]);
			};
			for (const device of await storedDevices(deps.db)) {
				profiles.set(device.deviceId, device.profiles);
				named(device.name, device.deviceId);
			}
			if (deps.profiles) profiles.set(self.id, deps.profiles.list());
			// Another Device of this name is a different one.
			ids.set(self.name, [self.id]);
			return {
				deviceId,
				deviceIdByName(name) {
					const found = ids.get(name) ?? [];
					return found.length === 1 ? (found[0] as string) : null;
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
