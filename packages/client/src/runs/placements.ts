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
	/** Where a run goes when the person chooses none, as Night Shift decides it. */
	default?: boolean;
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
		...(placement.default ? { default: true } : {}),
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

/**
 * What the Host is when another person runs it: whose it is, and what
 * they offer to this Space. Null for any other place.
 */
export function hostOwnerHint(
	choice: Pick<PlacementChoice, "thisDevice" | "offers" | "ownerName">,
): string | null {
	if (!choice.thisDevice || choice.offers === undefined) return null;
	const owner = choice.ownerName;
	if (!owner) {
		return choice.offers.length === 0
			? "This Host belongs to another person. It offers no profiles to this Space."
			: `This Host belongs to another person. It offers ${choice.offers.join(", ")} to this Space.`;
	}
	return choice.offers.length === 0
		? `This Host belongs to ${owner}. ${owner} has not offered it to this Space.`
		: `This Host belongs to ${owner}. ${owner} offers ${choice.offers.join(", ")} to this Space.`;
}

/**
 * The place a run goes when the person does not choose: the one they
 * chose while it is still online, else the one `runs.placements` marks as
 * the default (the engine's one rule for every start), else the first.
 * A Host of an older version marks none.
 */
export function defaultPlacement(
	choices: readonly PlacementChoice[],
	chosen: string | null,
): PlacementChoice | null {
	const online = choices.filter((choice) => choice.online);
	return (
		online.find((choice) => choice.deviceId === chosen) ??
		online.find((choice) => choice.default) ??
		online[0] ??
		null
	);
}
