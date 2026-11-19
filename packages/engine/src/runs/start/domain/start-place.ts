import type { Placement, StartRunInput } from "../../../contract";

/**
 * Where a run goes when it starts: who walks it, and its Run's Device.
 *
 * - `host`: the Host that keeps the Space walks the run (ADR 1, decision
 *   9). This computer hands the start to it, and says it is where the
 *   person started: the last fallback. `deviceId` is the person's pick.
 * - `here`: this computer walks the run. `deviceId` is the person's pick.
 *   Absent: the flow says where the run goes (`placement/device-order.ts`).
 *
 * The Walker: in a Space a Host keeps, the Host, while this computer
 * reaches it (decision 9). Else this computer: the Replica that keeps the
 * Space, or a Device that cannot reach its Host, which walks the run
 * itself and the exchange sends it to the Host later (decision 10).
 */
export type StartPlace =
	| { walker: "host"; startedFrom: string; deviceId?: string }
	| { walker: "here"; deviceId?: string };

/** What a schedule's start says when the Replica that keeps the Space has no copy of the project. */
export const SCHEDULE_PROJECT_MISSING =
	"The computer that runs schedules does not have this project. Add it there.";

/**
 * Where a start goes. `startedFrom` is this computer's id when the Host
 * that keeps the Space walks the run (it keeps it, and this computer
 * reaches it), else null.
 */
export function placeOf(
	start: Pick<StartRunInput, "deviceId">,
	startedFrom: string | null,
): StartPlace {
	if (startedFrom !== null) {
		return {
			walker: "host",
			startedFrom,
			...(start.deviceId !== undefined ? { deviceId: start.deviceId } : {}),
		};
	}
	return start.deviceId !== undefined
		? { walker: "here", deviceId: start.deviceId }
		: { walker: "here" };
}

/** One of the Person's own Devices, or another Person's that offers them something. */
export function usable(placement: Placement): boolean {
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
export function defaultOf(list: readonly Placement[]): Placement | null {
	return (
		list.find((p) => p.thisDevice && usable(p)) ??
		list.find((p) => p.lastRun && usable(p)) ??
		list.find((p) => p.offers === undefined) ??
		list[0] ??
		null
	);
}

/**
 * The Devices a person chooses from, as a screen that must preselect one
 * shows them: the Device of the project's latest run (`lastRun`, the id or
 * null) and the default (`defaultOf`) marked.
 */
export function markDefault(
	list: readonly Placement[],
	lastRun: string | null,
): Placement[] {
	const marked = list.map((p) =>
		p.deviceId === lastRun ? { ...p, lastRun: true } : p,
	);
	const chosen = defaultOf(marked);
	return marked.map((p) => (p === chosen ? { ...p, default: true } : p));
}
