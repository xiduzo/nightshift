import type { ProfileRef } from "@nightshift/flows";

/**
 * The profile a person picked by its name in the agent menus, as a flow
 * names it: this computer's, by its id. Null when this computer has none
 * of that name.
 */
export function profileHere(
	name: string,
	devices: readonly {
		deviceId: string;
		thisDevice: boolean;
		profiles?: readonly { id: string; name: string; kind: "agent" | "model" }[];
	}[],
): ProfileRef | null {
	const here = devices.find((device) => device.thisDevice);
	const profile = here?.profiles?.find(
		(one) => one.kind === "agent" && one.name === name,
	);
	return here && profile
		? { device: here.deviceId, profile: profile.id }
		: null;
}
