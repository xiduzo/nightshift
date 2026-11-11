import type { FlowSources, ProfileSettings } from "@nightshift/flows";
import type { WalkFile, WalkRef } from "../archive";
import type { Actor, OffersPort, Relay } from "../contract";
import type { Device } from "../device";
import type { DeviceCopy } from "../device-config";
import type { WalkFiles } from "../graph";
import type {
	CopyStamp,
	EnginePayloads,
	EventWrites,
	LandedScope,
	RunHistory,
	TranscriptEntry,
} from "../log";
import type { PlacementPort } from "../placement";
import type { Projects, SpaceDocuments } from "../projects";
import type { FeedStep, PendingCommand, RunWalker } from "../read";
import type { RunFolders } from "../run-folders";

/**
 * The port of the other Devices and Hosts (`Peers`). The run engine walks
 * runs on this computer and reads its own Replica. Everything that needs
 * another Device or a Host goes through this port: who a run's Devices
 * are and its plan (`PlacementPort`, in `placement/`), Offers, and the
 * runs walked elsewhere. `@nightshift/devices`
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
	/**
	 * The runs' own folders on this computer (ADR 22): the one folder a
	 * call of a run of a project without a folder may work in here.
	 */
	runFolders: Pick<RunFolders, "path">;
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
 * (`clones`, `clonePath`, and `clonedHere` that a Device tells its Host),
 * and on a Host, a Device's Clones, a Project it asks for and the
 * Projects it takes (`recordClone`, `setClones`, `addFromRemote`,
 * `defineWithoutFolder`, `take`).
 */
export type PeerProjects = Pick<
	Projects,
	| "find"
	| "ofSpace"
	| "matching"
	| "clones"
	| "clonePath"
	| "recordClone"
	| "setClones"
	| "clonedHere"
	| "forgetDevice"
	| "addFromRemote"
	| "defineWithoutFolder"
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
	/**
	 * Stops a run this computer walks: its running step ends as stopped.
	 * Night Shift stops it (an Offer ended), not a person.
	 */
	stop(runId: string): Promise<void>;
};

/** Makes the port, once per engine. */
export type PeersFactory = (context: PeerContext) => Peers;

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
