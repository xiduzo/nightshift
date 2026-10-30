import { hostOwnerHint, type PlacementChoice } from "@nightshift/client";

/** The line under the Device field of Start run: where the steps run, for the place chosen. */
export function placementDescription(
	device:
		| Pick<PlacementChoice, "thisDevice" | "offers" | "ownerName">
		| undefined,
	noDevice: boolean,
): string {
	if (noDevice) {
		return "None of your devices with this project is online. Start the run when one is.";
	}
	const host = device ? hostOwnerHint(device) : null;
	if (host) return host;
	if (device?.offers !== undefined) {
		return "Another person's device. The run can use only the profiles it offers to this Space.";
	}
	return "Pick one of your online devices with this project, or a device that others offer to this Space.";
}
