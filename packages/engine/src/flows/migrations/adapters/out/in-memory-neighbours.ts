import { inMemoryProfiles } from "../../../../settings/profiles/adapters/out/in-memory-profiles";
import type {
	KnownDevices,
	SpaceDevices,
	StoredDevices,
	ThisDevice,
} from "../../application/ports";
import type { NamedProfile } from "../../domain/device-names";

/**
 * The in-memory adapters of the ports that another slice or package
 * fills (every port of `application/ports.ts`), and
 * `inMemoryMigrationsPorts`, which gives a use-case test every port at
 * once. Test code: production code never imports this file.
 */

export function inMemoryThisDevice(id: string, name: string): ThisDevice {
	return { device: async () => ({ id, name }) };
}

export type InMemoryStoredDevices = StoredDevices & {
	devices: {
		deviceId: string;
		name: string | null;
		profiles: NamedProfile[];
	}[];
};

export function inMemoryStoredDevices(): InMemoryStoredDevices {
	const stored: InMemoryStoredDevices = {
		devices: [],
		list: async () => stored.devices,
	};
	return stored;
}

export type InMemoryKnownDevices = KnownDevices & {
	rows: { id: string; name: string; ownerId: string | null }[];
	owner: string | null;
	/** How often the owner of this computer was asked. */
	ownerAsked: number;
};

export function inMemoryKnownDevices(): InMemoryKnownDevices {
	const directory: InMemoryKnownDevices = {
		rows: [],
		owner: null,
		ownerAsked: 0,
		known: async () => directory.rows,
		async selfOwnerId() {
			directory.ownerAsked += 1;
			return directory.owner;
		},
	};
	return directory;
}

export type InMemorySpaceDevices = SpaceDevices & {
	/** By Space: the Devices of its document (id → value) and its Offers. */
	spaces: Record<
		string,
		{ devices: Record<string, unknown>; offers: unknown[] }
	>;
};

export function inMemorySpaceDevices(): InMemorySpaceDevices {
	const documents: InMemorySpaceDevices = {
		spaces: {},
		async open(spaceId) {
			const space = documents.spaces[spaceId] ?? { devices: {}, offers: [] };
			return {
				devices: { entries: () => Object.entries(space.devices) },
				offers: { values: () => space.offers },
			};
		},
	};
	return documents;
}

/** Every port of `flows/migrations` in memory at once, on the Device `laptop` named `MacBook`. */
export function inMemoryMigrationsPorts() {
	return {
		device: inMemoryThisDevice("laptop", "MacBook"),
		stored: inMemoryStoredDevices(),
		profiles: inMemoryProfiles(),
		directory: inMemoryKnownDevices(),
		spaces: inMemorySpaceDevices(),
	};
}
