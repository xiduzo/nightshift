import type {
	Flow,
	FlowNode,
	FlowSources,
	ProfileSettings,
	permissionModeSchema,
} from "@nightshift/flows";
import type { z } from "zod";
import type { WalkFile, WalkRef } from "../archive";
import type {
	Actor,
	NodeToPlace,
	OffersPort,
	OwnDevice,
	Placement,
	Relay,
	StartRunInput,
} from "../contract";
import type { Device } from "../device";
import type { DeviceCopy } from "../device-config";
import type { WalkFiles } from "../graph";
import type {
	CopyStamp,
	EnginePayloads,
	EventWrites,
	LandedScope,
	PlacedRun,
	RunHistory,
	RunPlan,
	TranscriptEntry,
} from "../log";
import type { ListedProject, Projects, SpaceDocuments } from "../projects";
import type { FeedStep, PendingCommand, RunWalker } from "../read";

/**
 * The port of the other Devices and Hosts (`Peers`). The run engine walks
 * runs on this computer and reads its own Replica. Everything that needs
 * another Device or a Host goes through this port: where a step runs
 * (Placement), Offers, and the runs walked elsewhere. `@nightshift/devices`
 * implements it. The daemon gives its factory to `createEngine`
 * (`EngineOptions.peers`), which calls it once with the engine's own
 * parts (`PeerContext`). Whether a Host keeps a Space is not here: the
 * `DeviceDirectory` answers it (`hostedElsewhere`), for the Space
 * documents too.
 */
export type Peers = {
	/** A run's plan, made once at its start, and the Devices a Person may use. */
	placement: PlacementPort;
	/** The Offer rule of a schedule on another Person's Device. */
	offers: OffersPort;
	/** The runs walked elsewhere, and the runs that move between Walkers. */
	runs: RunsPort;
	/**
	 * The Hosts this computer links to: the actions on rows another Device
	 * owns travel through them. None on a computer alone.
	 */
	relay?: Relay;
	/**
	 * A run as a Person may read it: the worktree path (and the take-over
	 * command that names it) only for the owner of the run's Device.
	 */
	pathsFor(
		spaceId: string,
		actor: Actor | undefined,
	): Promise<<T extends WithPaths>(summary: T) => Promise<T>>;
};

/**
 * What `createEngine` offers the port, made before it: capabilities in
 * the words of runs, Projects and profiles. The engine owns the tables of
 * runs, events, Projects, Clones, walk state and the Device documents:
 * the peers never get its database, its run log or its bus. Their own
 * rows (`@nightshift/devices`' tables) they keep in their own database
 * handle.
 */
export type PeerContext = {
	/** This computer as a Device. */
	device: Device;
	/** This computer as the Walker of the runs it walks: the id its events carry. */
	walkerId(): Promise<string>;
	/** The Person who owns this computer, or null before the engine is ready. */
	ownerId(): string | null;
	/** Resolves when the engine is ready. */
	ready: Promise<void>;
	now(): number;
	documents: SpaceDocuments;
	/** The Projects and their Clones, as the peers read and record them. */
	projects: PeerProjects;
	/** The project's flows, from this Replica's flow document: what a run starts from. */
	flows(projectId: string): Promise<FlowSources>;
	/** The profiles of this computer, and of the Devices whose documents this Replica keeps. */
	profiles: PeerProfiles;
	/**
	 * What the Device document this Replica keeps of another Device says
	 * of it (a Host keeps those of the Devices whose home Host it is):
	 * its name, its profiles, its secret names. Null when it keeps none.
	 */
	keptDevice(deviceId: string): Promise<DeviceCopy | null>;
	/**
	 * The run history of this Replica, as the exchange reads and adds to
	 * it: rows by cursor, the ingest, a run's owners and events, the files
	 * of the steps this computer walked, and what lands.
	 */
	history: PeerHistory;
	/** The runs this computer walks, as the peers act on them. */
	runs: PeerRuns;
	/**
	 * Logs a fact of no run the peers own (a Device's, an Offer's), in
	 * the Space it names, in one batch with the rows it names (`before`).
	 */
	logFact(fact: PeerFact, writes?: Pick<EventWrites, "before">): Promise<void>;
};

/** The facts of no run the peers log: a Device paired, gone, online or offline; an Offer made or withdrawn. */
type PeerFactType =
	| "DeviceJoined"
	| "DeviceRevoked"
	| "DeviceOnline"
	| "DeviceOffline"
	| "OfferMade"
	| "OfferWithdrawn";

/** A fact the peers log (`PeerContext.logFact`). */
export type PeerFact = {
	[T in PeerFactType]: {
		type: T;
		spaceId: string;
		payload: EnginePayloads[T];
	};
}[PeerFactType];

/**
 * The Projects as the peers get them (`PeerContext.projects`): a project
 * a person has not removed (`find`), the Projects of a Space and those of
 * a Device's personal Space (`ofSpace`, `matching`), the Clones
 * (`clones`, `clonePath`), and on a Host, a Device's Clone and the
 * Projects it takes (`recordClone`, `take`).
 */
export type PeerProjects = Pick<
	Projects,
	| "find"
	| "ofSpace"
	| "matching"
	| "clones"
	| "clonePath"
	| "recordClone"
	| "take"
>;

/** The profiles a run's steps may use, as this Replica knows them (`PeerContext.profiles`). */
export type PeerProfiles = {
	/** A profile of this computer by its id (`EngineOptions.profileFor`). Null for none. */
	here(id: string): ProfileSettings | null;
	/**
	 * A Device's profiles as its document last said, by id, with their
	 * settings: for a node on a Device that is offline. Null when this
	 * Replica never had its document.
	 */
	lastKnown(
		deviceId: string,
	): Promise<Map<string, { name: string; settings: ProfileSettings }> | null>;
};

/** The run history as the peers get it (`PeerContext.history`). */
export type PeerHistory = RunHistory & {
	/**
	 * Calls `listener` when a run event of `scope` lands here (appended or
	 * ingested) that changes what a reader shows, until the returned
	 * function is called. A spend so far (`SessionUsage`) alone does not:
	 * it goes with the next event that does.
	 */
	onLanded(listener: () => void, scope?: LandedScope): () => void;
};

/** What the peers do to the runs this computer walks (`PeerContext.runs`). */
export type PeerRuns = WalkFiles & {
	/**
	 * The stamp a copy of a step's files taken now carries, as this
	 * Replica's log says: which opening of the step, and whether it ended
	 * (and was not reopened since). Null for a step this Replica lacks.
	 */
	stepStamp(step: FeedStep): Promise<CopyStamp | null>;
	/** This computer walks a run another Device moved here, from now on. */
	takeOver(runId: string): Promise<void>;
	/** Stops a run this computer walks: its running step ends as stopped. */
	stop(runId: string): Promise<void>;
};

/** Makes the port, once per engine. */
export type PeersFactory = (context: PeerContext) => Peers;

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
	 * only reads it (`deviceFor`).
	 */
	plan(input: PlanInput): Promise<PlannedRun>;
	/** The Device a step of `node` runs on, as the run's plan says. */
	deviceFor(node: FlowNode, run: PlacedRun): Device;
	/** A Device by id, for a step of the run: this computer, or another Device of its plan. */
	deviceById(id: string, run: PlacedRun): Device;
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
};

/** A run's plan, with what run start goes on with. */
export type PlannedRun = {
	plan: RunPlan;
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

export type RunsPort = {
	/** The Walkers of runs of a Space (and the Devices their steps run on), by id. */
	walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>>;
	/** The actions on each run that wait for its Walker, by run id, in one read. */
	pendingCommands(
		runIds: readonly string[],
	): Promise<Map<string, PendingCommand[]>>;
	/**
	 * A step's transcript, wherever its run is walked and wherever its copy
	 * is kept: its entries after `afterSeq` (the run-wide seq), in `seq`
	 * order, each once, then each new one as it is written. It returns when
	 * the transcript is whole: the step ended and its last entry went out.
	 * Aborting `signal` ends it too, without an error. A Host that is away
	 * or a feed that drops does not end it: it tries again. It throws only
	 * when this Replica does not have the run.
	 */
	stepEntries(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/**
	 * Keeps a run's walk files in the archive of the Replica that keeps its
	 * Space (this one, or its Host): what a new Walker takes the run over
	 * from. Throws when that Host cannot be reached.
	 */
	keepWalk(files: readonly WalkFile[]): Promise<void>;
	/**
	 * A file of the archive: this Replica's copy, else its Host's. A copy
	 * of a step's file only when its stamp holds the step as this
	 * Replica's log says (`stampHolds`). Null when neither has one.
	 */
	archived(ref: WalkRef): Promise<string | null>;
};

/** A run summary or detail with the worktree fields `pathsFor` may hide. */
export type WithPaths = {
	device: { id: string; thisDevice: boolean };
	worktreePath: string;
	takeOverCommand?: string | null;
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
