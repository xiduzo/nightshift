import type {
	DecisionNode,
	Flow,
	FlowNode,
	FlowSources,
	ModelAddress,
	ProfileSettings,
	permissionModeSchema,
	ValueNode,
} from "@nightshift/flows";
import type { z } from "zod";
import type { DeviceProfile, RunPlan, StartRunInput } from "../../../contract";

/**
 * The shapes the plan reads and makes. `D` is a Device as the caller
 * reaches it, and `C` what a Device has. The plan never calls a Device
 * itself: it asks through `PlanRules`, so these rules hold no type of
 * the Devices.
 */

/** A Device a run's nodes run on, as its plan placed it. */
export type PlacedOn<D> = {
	device: D;
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

/** What the node walk asks of the Devices a run may use. */
export type PlanLookups<D> = {
	/** This computer: the Walker. */
	walker: PlacedOn<D>;
	/**
	 * The run's Device by its id: this computer (`walker`), or another
	 * Device the Person may use, checked. Null when this computer cannot
	 * reach it. Throws a refusal of its own (not theirs, offline).
	 */
	byId(id: string): Promise<PlacedOn<D> | null>;
	/**
	 * The Device a node runs on, by its id: the one its profile belongs to,
	 * or the one it names (`device`). This computer, one of the Person's
	 * other Devices, or another Person's through its Offers. Null when the
	 * Person cannot use a Device of that id in the Space. An offline one is
	 * `offline`: its steps wait for it. Throws a refusal of its own.
	 */
	nodeDevice(id: string): Promise<PlacedOn<D> | null>;
	/** A profile of this computer by its id, or null. */
	profileFor(id: string): ProfileSettings | null;
	/**
	 * Another Device's profiles as its document last said, by id, with
	 * their names (`lastKnownProfiles`): what a node on an offline Device
	 * starts with. Null when this computer has no copy. Default: none.
	 */
	lastKnown?(
		deviceId: string,
	): Promise<ReadonlyMap<
		string,
		{ name: string; settings: ProfileSettings }
	> | null>;
	/** The name of a Device by its id, for a refusal: one the Space no longer has too. Default: none. */
	deviceName?(deviceId: string): Promise<string | null>;
	/** The project's flows, from this Replica's flow document. */
	flows(projectId: string): Promise<FlowSources>;
	/** The Replica that keeps the Space: where a flow without a list runs (ADR 17). */
	keeperId?: string;
	/** The Host among the Devices, for the words of a move (`takenOverSecrets`). */
	hostId?: string;
	/** The Person's other Devices, for when no Device of the order can take the run. */
	lastResort?(): Promise<readonly string[]>;
	/** The profiles a run may use on a Device, by id. Null when unknown. */
	profilesOf?(deviceId: string): Promise<readonly DeviceProfile[] | null>;
};

/** A run's plan, with what run start goes on with. */
export type PlanOf<D> = {
	plan: RunPlan;
	/** The Devices the plan passed over, and why: what the run warns about. */
	notes: readonly string[];
	/** The run's Device, where its worktree goes. */
	run: PlacedOn<D>;
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
	groups: { at: PlacedOn<D>; nodes: FlowNode[] }[];
};

/** The address a Model Profile names, with the decider that asks it. */
export type AddressCheck = {
	decider: NonNullable<DecisionNode["decider"] | ValueNode["decider"]>;
	address: ModelAddress;
};

/** The flow a run starts, and the flows it calls, as the flow document has them (`flowsForRun`). */
export type RunFlows = {
	flow: Flow;
	flowName: string | null;
	flowRevision: string | null;
	calledFlows: Record<string, Flow>;
	calledFlowRevisions: Record<string, string>;
};

/**
 * The rules of other modules the plan asks, as functions: the one fit
 * check, what a Device has, the flows of a run and the words of a move.
 */
export type PlanRules<D, C> = {
	/** What the Device has for these nodes (`capabilitiesFor`). */
	capabilitiesFor(nodes: readonly FlowNode[], device: D): Promise<C>;
	/**
	 * Why a Device cannot take these nodes now, or null when it can
	 * (`unfit`). `has` is asked only when the cheaper checks pass.
	 */
	unfit(
		at: PlacedOn<D>,
		nodes: readonly FlowNode[],
		has: () => Promise<C | null>,
	): Promise<string | null>;
	/** Where a node works: in the run's worktree, on its Device, or neither. */
	works(node: FlowNode): "worktree" | "device" | null;
	/** The asked profiles the Device defines, by id: one it lacks is left out. */
	profilesOn(
		device: D,
		ids: string[],
	): Promise<Record<string, ProfileSettings>>;
	/** Whether the server at each address answers, by `addressKey`: null when it does, else why not. Absent: the Device did not check. */
	addressesOn(
		device: D,
		checks: AddressCheck[],
	): Promise<Record<string, string | null> | undefined>;
	/** One key per decider and address, as `addressesOn` answers it. */
	addressKey(check: AddressCheck): string;
	/** The flow of the start and the flows it calls (`flowsForRun`). */
	flowsForRun(sources: FlowSources, start: StartRunInput): RunFlows;
	/** What the warning of a move says about the secrets where the step goes (`takenOverSecrets`). */
	takenOverSecrets(at: { host: boolean }): string;
	/** The refusal of a run whose project is not on this computer. */
	notOnThisComputer: string;
};
