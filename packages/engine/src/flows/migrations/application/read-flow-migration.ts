import type { FlowMigration } from "@nightshift/flows";
import {
	flowMigration,
	type MigrationScope,
	spaceDevices,
} from "../domain/device-names";
import type {
	DeviceProfiles,
	KnownDevices,
	SpaceDevices,
	StoredDevices,
	ThisDevice,
} from "./ports";

export type ReadFlowMigrationPorts = {
	device: ThisDevice;
	stored: StoredDevices;
	/** Without them, the profiles of this Device's stored document. */
	profiles?: DeviceProfiles | undefined;
	/** Without them, only the documents. */
	directory?: KnownDevices | undefined;
	/** Without them, every Device counts. */
	spaces?: SpaceDevices | undefined;
};

/**
 * The migration of a flow whose nodes without a `device` took their
 * profile from `deviceId`: the Device that saved the flow's last
 * revision, or the one that imports it. `scope` is the Space of the flow
 * and the Person who saved it. It reads this Device, the Device documents,
 * this Device's profiles, the Device rows and the Space document, in that
 * order.
 */
export const readFlowMigration =
	(ports: ReadFlowMigrationPorts) =>
	async (request: {
		deviceId: string;
		scope?: MigrationScope | undefined;
	}): Promise<FlowMigration> => {
		const { scope } = request;
		const self = await ports.device.device();
		const stored = await ports.stored.list();
		const ownProfiles = ports.profiles?.list();
		const known = (await ports.directory?.known()) ?? [];
		const inSpace =
			scope && ports.spaces
				? spaceDevices(await ports.spaces.open(scope.spaceId))
				: undefined;
		const personId =
			scope === undefined
				? null
				: (scope.personId ?? (await ports.directory?.selfOwnerId()) ?? null);
		return flowMigration({
			deviceId: request.deviceId,
			self,
			stored,
			ownProfiles,
			known,
			inSpace,
			personId,
		});
	};
