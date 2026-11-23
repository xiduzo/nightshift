import type { FlowMigration } from "@nightshift/flows";
import type {
	DeviceProfiles,
	KnownDevices,
	SpaceDevices,
	StoredDevices,
	ThisDevice,
} from "./application/ports";
import { readFlowMigration } from "./application/read-flow-migration";
import type { MigrationScope } from "./domain/device-names";

/**
 * What brings a flow of an older format to the current one on this
 * Replica, and a schedule from before ids (`FlowMigration`). `forDevice`
 * gives the migration of a flow whose nodes without a `device` took their
 * profile from that Device. `scope` is the Space of the flow and the
 * Person who saved it.
 */
export type FlowMigrations = {
	forDevice(deviceId: string, scope?: MigrationScope): Promise<FlowMigration>;
};

/**
 * The migrations of the flows on this Replica. It knows the Device rows
 * (`directory`), the Devices and Offers of the Space document (`spaces`),
 * and the Device documents it keeps or copies (`stored`).
 */
export function wireMigrations(deps: {
	device: ThisDevice;
	stored: StoredDevices;
	profiles?: DeviceProfiles | undefined;
	directory?: KnownDevices | undefined;
	spaces?: SpaceDevices | undefined;
}): FlowMigrations {
	const read = readFlowMigration(deps);
	return {
		forDevice: (deviceId, scope) => read({ deviceId, scope }),
	};
}
