import type { Database } from "@nightshift/db";
import type { DeviceRows } from "@nightshift/engine";
import { thisComputer } from "../../machine";
import {
	type SelfDevice,
	type SelfDeviceHost,
	selfDeviceHost,
} from "./domain/self-device-host";
import { type DeviceRegistry, type PairedDeps, wireRegistry } from "./wire";

/**
 * The functions the registry had before its rings, over `wireRegistry`,
 * for the tests that drive it on a database. Each one makes the same
 * calls of the same use cases as the composition does.
 */

export { hostDeviceName, isContainerId } from "./domain/self-device-host";

/** The Devices paired with this Host (`DeviceRegistry`), on `db`. */
export function createDeviceRegistry(
	deps: PairedDeps & { db: Database },
): DeviceRegistry {
	return wireRegistry({ db: deps.db }).paired(deps);
}

/** The default name of this computer's Device, from what it says of itself unless a test says it. */
export function defaultSelfDeviceHost(
	opts: {
		env?: Record<string, string | undefined>;
		hostName?: string;
		container?: boolean;
		platform?: string;
		dev?: boolean;
	} = {},
): SelfDeviceHost {
	return selfDeviceHost({
		env: opts.env ?? thisComputer.env(),
		hostName: opts.hostName ?? thisComputer.hostName(),
		container: opts.container ?? thisComputer.inContainer(),
		platform: opts.platform ?? thisComputer.platform(),
		dev: opts.dev,
	});
}

/** This computer's Device, made when there is none (`ensureSelfDevice`). */
export function selfDevice(
	db: Database,
	host: SelfDeviceHost = defaultSelfDeviceHost(),
): Promise<SelfDevice> {
	return wireRegistry({ db }).ensureSelfDevice({ host });
}

/** The Person who owns this computer's Device, or null (`readSelfOwner`). */
export function selfOwnerId(db: Database): Promise<string | null> {
	return wireRegistry({ db }).readSelfOwner();
}

/** The Persons whose home Host this computer is (`listHomePersons`). */
export function homePersonsOf(db: Database): Promise<string[]> {
	return wireRegistry({ db }).listHomePersons();
}

/** Names the Person who owns this computer's Device (`setSelfOwner`). */
export function setSelfOwner(db: Database, personId: string): Promise<void> {
	return wireRegistry({ db }).setSelfOwner({ personId });
}

/** This install becomes the Device `deviceId` (`adoptSelfDevice`), without a registry of paired Devices. */
export function adoptSelfDevice(
	db: Database,
	rows: Pick<DeviceRows, "adopt">,
	deviceId: string,
	lastSeq = 0,
): Promise<void> {
	return wireRegistry({ db })
		.paired({
			logFact: async () => {},
			history: {
				devicePresence: async () => new Map(),
				lastWalkerSeq: async () => 0,
			},
			deviceRows: {
				adopt: (move) => rows.adopt(move),
				forget: () => [],
			},
		})
		.adopt(deviceId, lastSeq);
}
