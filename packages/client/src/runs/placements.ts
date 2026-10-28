import type { RunDevice, RunPlacement } from "./types";

/**
 * One place a run can go, for the start of a run: a Device that can take
 * it now, or one of your Devices that is offline (shown, not chosen).
 */
export type PlacementChoice = {
	deviceId: string;
	name: string;
	/** The computer that answers the call: the Host, for a phone. */
	thisDevice: boolean;
	/** Another person's Device: the profiles it offers to this Space. */
	offers?: string[];
	/** The Host when another person owns it: their name. */
	ownerName?: string;
	online: boolean;
	/** The project's latest run ran on it. */
	lastRun?: boolean;
};

/**
 * Where a run of the project can go: the Devices of `runs.placements`
 * (online, this one first), then your Devices with this project that are
 * offline, so the person sees why they cannot choose them.
 */
export function placementChoices(
	placements: readonly RunPlacement[],
	devices: readonly RunDevice[] = [],
): PlacementChoice[] {
	const online: PlacementChoice[] = placements.map((placement) => ({
		deviceId: placement.deviceId,
		name: placement.name,
		thisDevice: placement.thisDevice,
		...(placement.offers !== undefined ? { offers: placement.offers } : {}),
		...(placement.ownerName ? { ownerName: placement.ownerName } : {}),
		...(placement.lastRun ? { lastRun: true } : {}),
		online: true,
	}));
	const known = new Set(online.map((choice) => choice.deviceId));
	const offline: PlacementChoice[] = devices
		.filter(
			(device) =>
				!device.online && device.hasClone && !known.has(device.deviceId),
		)
		.map((device) => ({
			deviceId: device.deviceId,
			name: device.name,
			thisDevice: device.thisDevice,
			online: false,
		}));
	return [...online, ...offline];
}

/** One of your Devices, or another person's that offers you something. */
function usable(choice: Pick<PlacementChoice, "offers">): boolean {
	return choice.offers === undefined || choice.offers.length > 0;
}

/**
 * The place a run goes when the person does not choose: the one they
 * chose while it is still online, else this computer, else the one the
 * project's latest run ran on, else one of their own, else the first.
 * This computer and the latest run's Device count only when they are the
 * person's own or offer them something: a Host another person owns that
 * offers nothing is no default.
 */
export function defaultPlacement(
	choices: readonly PlacementChoice[],
	chosen: string | null,
): PlacementChoice | null {
	const online = choices.filter((choice) => choice.online);
	return (
		online.find((choice) => choice.deviceId === chosen) ??
		online.find((choice) => choice.thisDevice && usable(choice)) ??
		online.find((choice) => choice.lastRun && usable(choice)) ??
		online.find((choice) => choice.offers === undefined) ??
		online[0] ??
		null
	);
}
