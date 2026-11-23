import type { StartRunInput } from "../../contract";
import type { Device } from "../../device";
import { flowsForRun } from "../../flows";
import { type ListedProject, NOT_ON_THIS_COMPUTER } from "../../projects";
import { takenOverSecrets } from "../../secrets";
import type { PlacedOn, PlanLookups, PlanOf } from "../domain/plan-shapes";
import { planRun } from "../domain/run-plan";
import type { DeviceFit } from "./ports";

/** A Device a run's nodes run on, as its plan placed it. */
export type PlacedDevice = PlacedOn<Device>;

/** What the node walk asks of the Devices a run may use. */
export type PlanDevices = PlanLookups<Device>;

/** A run's plan, with what run start goes on with. */
export type PlannedRun = PlanOf<Device>;

/** What a run's plan starts from (`PlacementPort.plan`). */
export type PlanInput = {
	start: StartRunInput;
	/** The run's project, in the Space the run takes. */
	project: ListedProject;
	runId: string;
	/**
	 * A schedule starts it: a `startedBy` it names is the schedule's
	 * Person as the Host of the Space knows them already.
	 */
	scheduled: boolean;
	/** A person starts it: a Device the start names is their pick (ADR 17). */
	byPerson: boolean;
	/** The Device of the project's latest run: the first of the last resorts. Default: none. */
	lastRun?: string | null;
};

export type PlanNodesPorts = { fit: DeviceFit };

/**
 * Plans a run over the Devices it may use (`PlanDevices`), as the domain's
 * node walk says (`planRun`), with the fit check of the walk, the flows of
 * the run, the words of a move and the refusal of a project that is not on
 * this computer. The devices' planner (`PlacementPort.plan`) calls it, and
 * so does the engine's own fake of a computer alone.
 */
export function planNodes(ports: PlanNodesPorts) {
	const rules = {
		...ports.fit,
		flowsForRun,
		takenOverSecrets,
		notOnThisComputer: NOT_ON_THIS_COMPUTER,
	};
	return (
		start: StartRunInput,
		devices: PlanDevices,
		personId: string | null,
		/** A person starts it: a Device the start names is their pick (ADR 17). */
		byPerson = true,
	): Promise<PlannedRun> => planRun(start, devices, personId, byPerson, rules);
}
