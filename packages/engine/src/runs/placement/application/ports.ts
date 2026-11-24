import type { OwnDevice, PersonActor, Placement } from "../../../contract";
import type { Capabilities, Device } from "../../../device";
import type { PlacedRun } from "../../../log";
import type { PlanRules } from "../domain/plan-shapes";
import type { PlanInput, PlannedRun } from "./plan-nodes";

/**
 * The port Placement asks of the other Devices (`PlacementPort`, the
 * placement half of `Peers`): who a run's Devices are, and a run's plan
 * over them. `@nightshift/devices` implements it over its registry, its
 * Links and its Offers; the engine's own fake of a computer alone
 * (`testing/alone-peers.ts`) answers with this computer only. The rule of
 * where a step runs is not here: `planNodes` and the walk's reader of the
 * plan (`createPlacement` in `graph`) hold it.
 * @filledBy devices
 */
export type PlacementPort = {
	/**
	 * Plans a run at its start, once (`RunPlan`): the Person it runs for,
	 * as the Host of its Space knows them; its Device (`deviceId`, else
	 * this computer); and the Device of each node: its `device`, else its
	 * profile's Device, else the run's. Every Device is checked: one of the
	 * Person's own, or another Person's through its Offers into the Space
	 * (the nodes placed there stay within them), online, with a Clone for
	 * the run's worktree. Returns the flows it runs, from that Device's
	 * Clone, each profile resolved where its node runs. Throws the refusal.
	 * Run start keeps the plan on the run's row (`planColumns`); the walk
	 * only reads it (`createPlacement`).
	 */
	plan(input: PlanInput): Promise<PlannedRun>;
	/**
	 * A Device of a run by id, as the run reaches it: this computer, or
	 * another Device of its plan over the Host. `name` is what to call it
	 * when the plan keeps no name of it. It decides nothing.
	 */
	deviceById(id: string, run: PlacedRun, name?: string): Device;
	/**
	 * The Device a run's walk moves to (`to`): one of the Person's own
	 * Devices, not this computer, online. Null when it is not one of
	 * theirs; throws the refusal when it is offline. A move keeps the plan:
	 * each node's Device and the run's Person stay, only the Walker changes.
	 */
	moveTo(
		run: PlacedRun,
		actor: PersonActor,
		to: string,
	): Promise<{ id: string; name: string } | null>;
	/**
	 * The Devices a Person may place a run's steps on: their own, then
	 * others' through Offers. With `ownOnly`, the Devices that node may
	 * name: another Person's only when the Person may run the node's
	 * profile there through its Offers.
	 */
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
		ownOnly?: boolean,
	): Promise<OwnDevice[]>;
	/** The Devices a run of the project can run on: online, with a Clone. */
	placements(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]>;
};

/**
 * What the plan asks of the walk and of the Devices, as functions: the one
 * fit check (`graph`), and what a Device has and how its addresses are
 * keyed (`device`).
 * @filledBy engine/wire
 */
export type DeviceFit = Pick<
	PlanRules<Device, Capabilities>,
	| "capabilitiesFor"
	| "unfit"
	| "works"
	| "profilesOn"
	| "addressesOn"
	| "addressKey"
>;
