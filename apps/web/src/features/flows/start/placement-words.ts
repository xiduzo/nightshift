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
	if (device)
		return "Steps without a profile run here first. A step with a profile runs on that profile's computer.";
	return "A step with a profile runs on that profile's computer. Other steps use the flow's devices, else your Host.";
}
