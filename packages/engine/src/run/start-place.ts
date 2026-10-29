import type { Placement, StartRunInput } from "../contract";
import type { PlacementPort } from "./peers";

/**
 * Where a run goes when it starts: who walks it, and its Run's Device.
 *
 * - `host`: the Host that keeps the Space walks the run (ADR 1, decision
 *   9). This computer hands the start to it. `deviceId` is the Run's
 *   Device: the one the start names, else this computer, so the run's
 *   unplaced steps run where the person started it.
 * - `here`: this computer walks the run. `deviceId` is its Run's Device
 *   when that is another Device. Absent: this computer, or the Device a
 *   schedule names by name (`deviceName`), which the run's plan finds.
 */
export type StartPlace =
	| { walker: "host"; deviceId: string }
	| { walker: "here"; deviceId?: string };

export type StartPlaces = ReturnType<typeof createStartPlaces>;

/** One of the Person's own Devices, or another Person's that offers them something. */
function usable(placement: Placement): boolean {
	return placement.offers === undefined || placement.offers.length > 0;
}

/**
 * The Run's Device when a start names none: this computer, else the
 * Device of the project's latest run, else one of the Person's own, else
 * the first. This computer and the latest run's Device count only when
 * they are the Person's own or offer them something: a Host another
 * Person owns that offers nothing is no default. The list has this
 * computer only when it has a Clone of the project.
 */
function defaultOf(list: readonly Placement[]): Placement | null {
	return (
		list.find((p) => p.thisDevice && usable(p)) ??
		list.find((p) => p.lastRun && usable(p)) ??
		list.find((p) => p.offers === undefined) ??
		list[0] ??
		null
	);
}

/**
 * The one rule for where a run goes when it starts (`StartPlace`), for
 * every start: a person's (from a Device, a phone or a browser), a
 * schedule's and a webhook's.
 *
 * - The Walker: in a Space a Host keeps, the Host, while this computer
 *   reaches it (decision 9). Else this computer: the Replica that keeps
 *   the Space, or a Device that cannot reach its Host, which walks the
 *   run itself and the exchange sends it to the Host later (decision 10).
 * - The Run's Device: the Device the start names (by id, or a schedule's
 *   by name). Else the default among the Devices the Person may run the
 *   project on (`defaultOf`). A start for nobody runs on this computer.
 *
 * The Devices a person chooses from (`placements`) mark the same
 * default, so Start run shows where a run goes without a rule of its own.
 */
export function createStartPlaces(deps: {
	/** Whether a Host keeps the Space, not this Replica (`DeviceDirectory`). */
	hostedElsewhere(spaceId: string): Promise<boolean>;
	/** Whether this computer reaches the Host that keeps the Space now (`Relay.reachable`). */
	hostReachable(spaceId: string): Promise<boolean>;
	/** This computer's id as the Walker of its runs. */
	walkerId(): Promise<string>;
	placements: PlacementPort["placements"];
	/** The Device the project's latest run ran on, or null (`lastRunDevice`). */
	lastRunDevice(projectId: string): Promise<string | null>;
}) {
	/**
	 * The Devices a run of the project can run on, for a Person: the one
	 * of the project's latest run and the default (`defaultOf`) marked.
	 */
	async function placements(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]> {
		const last = await deps.lastRunDevice(projectId);
		const list = (await deps.placements(spaceId, personId, projectId)).map(
			(p) => (p.deviceId === last ? { ...p, lastRun: true } : p),
		);
		const chosen = defaultOf(list);
		return list.map((p) => (p === chosen ? { ...p, default: true } : p));
	}

	/**
	 * Where a start goes. `personId` is the Person it runs for: the one
	 * who starts it, a schedule's Person, or this computer's owner; null
	 * for nobody.
	 */
	async function place(
		spaceId: string,
		start: StartRunInput,
		personId: string | null,
	): Promise<StartPlace> {
		if (
			(await deps.hostedElsewhere(spaceId)) &&
			(await deps.hostReachable(spaceId))
		) {
			return {
				walker: "host",
				deviceId: start.deviceId ?? (await deps.walkerId()),
			};
		}
		if (start.deviceId !== undefined) {
			return { walker: "here", deviceId: start.deviceId };
		}
		if (start.deviceName !== undefined || personId === null) {
			return { walker: "here" };
		}
		const chosen = (await placements(spaceId, personId, start.projectId)).find(
			(p) => p.default,
		);
		return chosen && !chosen.thisDevice
			? { walker: "here", deviceId: chosen.deviceId }
			: { walker: "here" };
	}

	return { placements, place };
}
