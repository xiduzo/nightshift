import type { PersonActor, PlacedRun } from "@nightshift/engine";
import { Refusal } from "@nightshift/refusal";
import { listedThroughOffers } from "../domain/through-offers";
import { type ListOwnDevicesPorts, listOwnDevices } from "./list-own-devices";

/**
 * Finds the Device a run's walk moves to: one of the Person's own Devices
 * (as the Host of the run's Space knows them), not this computer, and
 * online. A run moves only to a Device of its own Person: a Device the
 * Host lists with its Offers is another Person's, and takes steps only.
 */
export function findMoveTarget(ports: ListOwnDevicesPorts) {
	const ownDevices = listOwnDevices(ports);
	return async (
		run: PlacedRun,
		actor: PersonActor,
		to: string,
	): Promise<{ id: string; name: string } | null> => {
		const personId = await ports.people.personInSpace(
			run.spaceId,
			actor.personId,
		);
		const target = (
			await ownDevices(run.spaceId, personId, run.projectId)
		).find((d) => d.deviceId === to);
		if (!target || target.thisDevice || listedThroughOffers(target)) {
			return null;
		}
		if (!target.online) {
			throw new Refusal(
				"unavailable",
				`${target.name} is offline. Move the run when it is online.`,
			);
		}
		return { id: target.deviceId, name: target.name };
	};
}
