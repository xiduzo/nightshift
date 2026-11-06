import type { Flow, FlowNode, permissionModeSchema } from "@nightshift/flows";
import type { z } from "zod";
import type {
	Actor,
	NodeToPlace,
	OwnDevice,
	Placement,
	StartRunInput,
} from "../contract";
import type { Device } from "../device";
import type { PlacedRun, RunPlan } from "../log";
import type { ListedProject } from "../projects";

/**
 * The port Placement asks of the other Devices (`PlacementPort`, the
 * placement half of `Peers`): who a run's Devices are, and a run's plan
 * over them. `@nightshift/devices` implements it over its registry, its
 * Links and its Offers; the engine's own fake of a computer alone
 * (`testing/alone-peers.ts`) answers with this computer only. The rule of
 * where a step runs is not here: `run-plan.ts` and `placement.ts` hold it.
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
		actor: Actor,
		to: string,
	): Promise<{ id: string; name: string } | null>;
	/**
	 * The Devices a Person may place a run's steps on: their own, then
	 * others' through Offers. With `forNode`, the Devices that node may
	 * name: another Person's only when the Person may run the node's
	 * profile there through its Offers.
	 */
	devicesFor(
		spaceId: string,
		personId: string,
		projectId: string,
		forNode?: NodeToPlace,
	): Promise<OwnDevice[]>;
	/** The Devices a run of the project can run on: online, with a Clone. */
	placements(
		spaceId: string,
		personId: string,
		projectId: string,
	): Promise<Placement[]>;
};

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

/** A run's plan, with what run start goes on with. */
export type PlannedRun = {
	plan: RunPlan;
	/** The Devices the plan passed over, and why: what the run warns about. */
	notes: readonly string[];
	/** The run's Device, where its worktree goes. */
	run: PlacedDevice;
	flow: Flow;
	flowName: string | null;
	/** The Flow revision the run starts from, or null (`flowsForRun`). */
	flowRevision: string | null;
	calledFlows: Record<string, Flow>;
	/** The Flow revision of each called flow that has one, by name. */
	calledFlowRevisions: Record<string, string>;
	/**
	 * Each Device with the nodes placed on it, every node once: run start
	 * asks each Device whether it has what its nodes need. The plan checked
	 * the nodes on an offered Device against its Offers already.
	 */
	groups: { at: PlacedDevice; nodes: FlowNode[] }[];
};

/** A Device a run's nodes run on, as its plan placed it. */
export type PlacedDevice = {
	device: Device;
	id: string;
	name: string;
	/** This computer: the Walker. */
	thisDevice: boolean;
	/** It has a Clone of the project: a step that works in the worktree can run there. */
	hasClone: boolean;
	/**
	 * Another Person's Device (this computer too, for a Member who does not
	 * own it): the run uses it through its Offers into the Space only. Its
	 * nodes keep their profile unresolved (the Device resolves it), and the
	 * Offer's rule, which the plan checks, replaces the requirements: its
	 * capabilities are its owner's.
	 */
	offered?: OfferedPlacement;
	/**
	 * It is offline now: its steps wait for it, up to the stop time. The
	 * start asks it nothing: it checks each call itself when it is back.
	 * As the run's Device, it makes the run's worktree then.
	 */
	offline?: boolean;
};

/** What a run start knows of the Offers of the Device it places a run of another Person on. */
export type OfferedPlacement = {
	deviceName: string;
	/** Its Offers into the run's Space: the profile's id and its name. */
	offers: readonly {
		profile: string;
		profileName: string;
		permissionCap: z.infer<typeof permissionModeSchema>;
	}[];
	/** The starter's role in the Space uses Offers (`offer.use`). */
	mayUse: boolean;
};
