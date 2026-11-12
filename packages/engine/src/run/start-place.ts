import { Refusal } from "@nightshift/refusal";
import type { Placement, StartRunInput } from "../contract";
import type { RunTrigger } from "../log";
import type { PlacementPort } from "../placement";
import { NOT_ON_THIS_COMPUTER } from "../projects";
import type { RunSummary } from "../read";
import { refuseTestStart } from "./test-run";

/**
 * Where a run goes when it starts: who walks it, and its Run's Device.
 *
 * - `host`: the Host that keeps the Space walks the run (ADR 1, decision
 *   9). This computer hands the start to it, and says it is where the
 *   person started: the last fallback. `deviceId` is the person's pick.
 * - `here`: this computer walks the run. `deviceId` is the person's pick.
 *   Absent: the flow says where the run goes (`placement/device-order.ts`).
 */
export type StartPlace =
	| { walker: "host"; startedFrom: string; deviceId?: string }
	| { walker: "here"; deviceId?: string };

export type StartPlaces = ReturnType<typeof createStartPlaces>;

/** What a schedule's start says when the Replica that keeps the Space has no copy of the project. */
export const SCHEDULE_PROJECT_MISSING =
	"The computer that runs schedules does not have this project. Add it there.";

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
 * The one rule for where a run goes when it starts (`StartPlace`), and
 * the start that follows it, for every start: a person's (from a Device,
 * a phone or a browser), a schedule's and a webhook's.
 *
 * - The Walker: in a Space a Host keeps, the Host, while this computer
 *   reaches it (decision 9). Else this computer: the Replica that keeps
 *   the Space, or a Device that cannot reach its Host, which walks the
 *   run itself and the exchange sends it to the Host later (decision 10).
 * - The Run's Device: `placement/device-order.ts` decides it when the run
 *   is planned. A schedule's run keeps the Replica that keeps the Space
 *   as its Device (ADR 15).
 *
 * The Devices a person chooses from (`placements`) mark a default for a
 * screen that must preselect one.
 */
export function createStartPlaces(deps: {
	/** Resolves when the engine is ready: a start waits for it. */
	ready: Promise<void>;
	/** Whether a Host keeps the Space, not this Replica (`DeviceDirectory`). */
	hostedElsewhere(spaceId: string): Promise<boolean>;
	/** Whether this computer reaches the Host that keeps the Space now (`Relay.reachable`). */
	hostReachable(spaceId: string): Promise<boolean>;
	/** The Host that keeps the Space, or null when this Replica does (`DeviceDirectory.hostOf`). */
	hostOf(spaceId: string): Promise<string | null>;
	/** This computer's id as the Walker of its runs. */
	walkerId(): Promise<string>;
	placements: PlacementPort["placements"];
	/** The Device the project's latest run ran on, or null (`lastRunDevice`). */
	lastRunDevice(projectId: string): Promise<string | null>;
	/** The Space of a project a person has not removed; throws for another id. */
	spaceOf(projectId: string): Promise<string>;
	/** Hands a start to the Host that keeps the Space (`RunRelay.startOnHost`). */
	startOnHost(input: StartRunInput, spaceId: string): Promise<RunSummary>;
	/** Starts the run on this computer, in the Space's start hold (`RunStart.start`). */
	startHere(
		spaceId: string,
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary>;
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

	/** Where a start goes. */
	async function place(
		spaceId: string,
		start: StartRunInput,
	): Promise<StartPlace> {
		if (
			(await deps.hostedElsewhere(spaceId)) &&
			(await deps.hostReachable(spaceId))
		) {
			return {
				walker: "host",
				startedFrom: await deps.walkerId(),
				...(start.deviceId !== undefined ? { deviceId: start.deviceId } : {}),
			};
		}
		return start.deviceId !== undefined
			? { walker: "here", deviceId: start.deviceId }
			: { walker: "here" };
	}

	/**
	 * Starts a run, for the Person it runs for, where its start place says:
	 * the Host that keeps the Space walks it, or this computer does, on
	 * the Run's Device the start names or the default one.
	 */
	async function start(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		await deps.ready;
		// The Host's start knows no trigger: refuse here what it cannot.
		refuseTestStart(input, trigger);
		const spaceId = await deps.spaceOf(input.projectId);
		const at = await place(spaceId, input);
		if (at.walker === "host") {
			return deps.startOnHost(
				{ ...input, startedFrom: at.startedFrom },
				spaceId,
			);
		}
		const placed =
			at.deviceId === undefined ? input : { ...input, deviceId: at.deviceId };
		return deps.startHere(spaceId, placed, trigger);
	}

	/**
	 * A schedule's or a webhook's start, also Run now: for the schedule's
	 * Person, else this computer's owner. It always runs on the Replica that
	 * keeps the Space: its Host, or this computer in a Space without one
	 * (ADR 15). A Host without a copy of the project refuses it. It does not
	 * move to another Device.
	 */
	async function startForSchedule(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		const spaceId = await deps.spaceOf(input.projectId);
		const deviceId = (await deps.hostOf(spaceId)) ?? (await deps.walkerId());
		return start({ ...input, deviceId }, trigger).catch((error: unknown) => {
			if (error instanceof Refusal && error.message === NOT_ON_THIS_COMPUTER) {
				throw new Refusal(error.kind, SCHEDULE_PROJECT_MISSING);
			}
			throw error;
		});
	}

	return { placements, place, start, startForSchedule };
}
