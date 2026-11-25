import type { Placement } from "@nightshift/engine";
import { takesRuns } from "../domain/takes-work";
import { type ListRunDevicesPorts, listRunDevices } from "./list-run-devices";

/** Lists the Devices a run of the project can run on: the ones it goes to when nobody names one. */
export function listPlacements(ports: ListRunDevicesPorts) {
	const devicesFor = listRunDevices(ports);
	return async (
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]> =>
		(await devicesFor(spaceId, personId, projectId))
			.filter(takesRuns)
			.map(({ deviceId, name, thisDevice, offers, ownerName }) => ({
				deviceId,
				name,
				thisDevice,
				...(offers ? { offers } : {}),
				...(ownerName ? { ownerName } : {}),
			}));
}
