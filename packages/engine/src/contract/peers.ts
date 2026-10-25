import type { Database } from "@nightshift/db";
import type {
	AgentProfileSettings,
	Flow,
	FlowNode,
	permissionModeSchema,
	Schedule,
} from "@nightshift/flows";
import type { FlowSources } from "@nightshift/flows/files";
import type { z } from "zod";
import type { Device } from "../device";
import type {
	CopyStamp,
	PlannedDevice,
	RunBus,
	RunHistory,
	RunLog,
	RunPlan,
	RunRow,
	TranscriptEntry,
} from "../log";
import type { ListedProject, SpaceDocuments } from "../projects";
import type { PendingCommand, RunWalker } from "../read";
import type { Actor, StartRunInput } from "./engine";
import type { Relay } from "./relay";

/**
 * The port of the other Devices and Hosts (`Peers`). The run engine walks
 * runs on this computer and reads its own Replica. Everything that needs
 * another Device or a Host goes through this port: where a step runs
 * (Placement), Offers, the Host that keeps a Space, and the runs walked
 * elsewhere. `@nightshift/devices` implements it. The daemon gives its
 * factory to `createEngine` (`EngineOptions.peers`), which calls it once
 * with the engine's own parts (`PeerContext`).
 */
export type Peers = {
	/** A run's plan, made once at its start, and the Devices a Person may use. */
	placement: PlacementPort;
	/** The Offer rule of a schedule on another Person's Device. */
	offers: OffersPort;
	/** The Host that keeps the Space, or null when this Replica keeps it. */
	hostOf(spaceId: string): Promise<string | null>;
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

/** What `createEngine` gives the port: its own parts, made before the port. */
export type PeerContext = {
	db: Database;
	dataDir: string;
	/** This computer as a Device. */
	device: Device;
	log: RunLog;
	bus: RunBus;
	/**
	 * The rows of runs, steps, agent sessions and events, as the exchange
	 * reads and adds them, and the files of the steps this computer walked.
	 * The engine owns those tables: the peers touch them only here.
	 */
	history: RunHistory;
	/**
	 * The walk state of the runs this computer walks, as the archive keeps
	 * it. The engine owns the checkpoint tables: the peers read them only
	 * here, and never write them.
	 */
	walks: WalkFiles;
	documents: SpaceDocuments;
	now(): number;
	/** An Agent Profile of this computer by name (`EngineOptions.profileFor`). */
	profileFor?: (name: string) => AgentProfileSettings | null;
	/** Resolves when the engine is ready. */
	ready: Promise<void>;
	/** The Person who owns this computer, or null before the engine is ready. */
	ownerId(): string | null;
	/**
	 * The stamp a copy of a step's files taken now carries, as this
	 * Replica's log says: which opening of the step, and whether it ended
	 * (and was not reopened since). Null for a step this Replica lacks.
	 */
	stepStamp(step: FeedStep): Promise<CopyStamp | null>;
	/** A project a person has not removed, with its Clone here or null. */
	project(projectId: string, spaceId: string): Promise<ListedProject>;
	/** This computer walks a run another Device moved here, from now on. */
	takeOver(runId: string): Promise<void>;
	/** Stops a run this computer walks: its running step ends as stopped. */
	stopRun(runId: string): Promise<void>;
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
	/** The Device a step of `node` runs on, as the run's plan says (`planOf`). */
	deviceFor(node: FlowNode, row: RunRow): Device;
	/** A Device by id, for a step of the run: this computer, or another Device of its plan. */
	deviceById(id: string, row: RunRow): Device;
	/**
	 * The Device a run's walk moves to (`to`): one of the Person's own
	 * Devices, not this computer, online. Null when it is not one of
	 * theirs; throws the refusal when it is offline. A move keeps the plan:
	 * each node's Device and the run's Person stay, only the Walker changes.
	 */
	moveTo(
		row: RunRow,
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
	/** The flow files of a project without a Clone here: from another of the Person's Devices. */
	flowsElsewhere(
		spaceId: string,
		projectId: string,
		actor: string | undefined,
	): Promise<FlowSources>;
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

export type { PlannedDevice };

/** A run's plan, with what run start goes on with. */
export type PlannedRun = {
	plan: RunPlan;
	/** The run's Device, where its worktree goes. */
	run: PlacedDevice;
	flow: Flow;
	flowName: string | null;
	calledFlows: Record<string, Flow>;
	/**
	 * Each Device with the nodes placed on it, every node once: run start
	 * asks each Device whether it has what its nodes need. The plan checked
	 * the nodes on an offered Device against its Offers already.
	 */
	groups: { at: PlacedDevice; nodes: FlowNode[] }[];
};

export type OffersPort = {
	/**
	 * The schedules of a project as a Person saves them: a schedule that
	 * fires on another Person's Device gets the saver as its `person`, and
	 * is refused unless that Device's Offers cover what its flow runs there.
	 */
	schedulesWithOffers(
		project: { id: string; repoPath: string },
		spaceId: string,
		actor: Actor | undefined,
		schedules: readonly Schedule[],
	): Promise<Schedule[]>;
};

export type RunsPort = {
	/** The Walkers of runs of a Space (and the Devices their steps run on), by id. */
	walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>>;
	/** The actions on a run that wait for its Walker. */
	pendingCommands(runId: string): Promise<PendingCommand[]>;
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

/** A file of a run's walk state, by its Space and run (and step). */
export type WalkRef =
	| { kind: "checkpoint"; spaceId: string; runId: string }
	| {
			kind: "transcript" | "log";
			spaceId: string;
			runId: string;
			stepId: string;
	  };

/**
 * One file of a run's walk state. Its content is the engine's: the peers
 * keep and carry it. A step's file has the stamp of the end it holds.
 */
export type WalkFile = { ref: WalkRef; content: string; stamp?: CopyStamp };

/** What the peers read of the walk state of the runs this computer walks. */
export type WalkFiles = {
	/**
	 * The walk state of a run this computer walks: the transcript and the
	 * command log of each of `steps` (default: every step of the run) that
	 * it has, each with its stamp, then the latest Checkpoint. Empty for a
	 * run walked elsewhere.
	 */
	exportWalk(
		runId: string,
		options?: { steps?: readonly string[] },
	): Promise<WalkFile[]>;
	/**
	 * One file of a run this computer walks. Null when it has none, when
	 * another Device walks the run, or when the step is not of the run.
	 */
	ownFile(ref: WalkRef): Promise<string | null>;
};

/** One step, by its Space and run. */
export type FeedStep = { spaceId: string; runId: string; stepId: string };

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
};

/** What a run start knows of the Offers of the Device it places a run of another Person on. */
export type OfferedPlacement = {
	deviceName: string;
	/** Its Offers into the run's Space. */
	offers: readonly {
		profile: string;
		permissionCap: z.infer<typeof permissionModeSchema>;
	}[];
	/** The starter's role in the Space uses Offers (`offer.use`). */
	mayUse: boolean;
};

/**
 * A Device a run of a project can be placed on, online, with a Clone of
 * the project: one of the Person's own, or another Person's that offers
 * profiles to the Space.
 */
export type Placement = {
	deviceId: string;
	name: string;
	/** This computer. */
	thisDevice: boolean;
	/**
	 * Another Person's Device: the profiles it offers to the Space, the
	 * only ones a run there may use. Absent for the Person's own Devices.
	 */
	offers?: string[];
};

/**
 * A node, as far as the choice of its Device goes: the profile of an
 * Agent node, or none (a node that runs nothing offered).
 */
export type NodeToPlace = { profile?: string };

/** One of a Person's Devices, as placement sees it. */
export type OwnDevice = Placement & {
	/** It takes work now. */
	online: boolean;
	/** It has a Clone of the project. */
	hasClone: boolean;
};
