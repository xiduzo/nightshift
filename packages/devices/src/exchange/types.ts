import type {
	CopyStamp,
	FeedStep,
	LeaseAnswer,
	LeaseTake,
	OwnDevice,
	RunCommandInput,
	StartRunInput,
	TestRunRequest,
	TranscriptEntry,
} from "@nightshift/engine";
import type {
	ArchiveRef,
	Caller,
	CommandBatch,
	KnowledgeRef,
	OfferCaps,
	PersonalMerge,
	PersonalMergeInput,
	RunRows,
	SyncBatch,
	SyncCursors,
	WorkDelivery,
	WorkReply,
	WorkRequest,
} from "../contract";

/**
 * This computer as the Host of run history, for its paired Devices. Each
 * call carries its Caller: the Device key the Host admitted once, with
 * its Person's roles (`Devices.admit`). The Host filters by that Person's
 * membership and never lets a Device write a row of another Walker.
 *
 * Refusals are ORPCErrors: FORBIDDEN (the Device may not do this),
 * CONFLICT (not yet: try again later). Any other error is a failure
 * written for people.
 */
export type HostExchange = {
	/** Rows of the Spaces the Caller's Person is a Member of, after the cursors, but the Device's own. */
	pull(caller: Caller, input: { cursors: SyncCursors }): Promise<SyncBatch>;
	/**
	 * The same, then every new batch as rows land, until the signal
	 * aborts. `commands: false` leaves the Commands out: the Device takes
	 * them from `commands`.
	 */
	stream(
		caller: Caller,
		input: { cursors: SyncCursors; commands?: boolean },
		signal?: AbortSignal,
	): AsyncIterable<SyncBatch>;
	/**
	 * The Commands that wait for the Caller's Device, the whole set, then
	 * again each time it changes, until the signal aborts.
	 */
	commands(caller: Caller, signal?: AbortSignal): AsyncIterable<CommandBatch>;
	/** Takes the Device's own rows. Refuses a batch with a row of another Walker or Space. */
	push(caller: Caller, rows: RunRows): Promise<{ events: number }>;
	/** A person's action on a run another Device walks, in the name of the Caller's Person. */
	command(
		caller: Caller,
		input: RunCommandInput & { runId: string },
	): Promise<void>;
	/** The Walker applied a command, or says why not. */
	commandDone(
		caller: Caller,
		input: { id: string; error: string | null },
	): Promise<void>;
	/**
	 * Takes a lease of a Space of this Host for a run the Caller's Device
	 * walks (ADR 7). Needs `run.start` in the Space.
	 */
	leaseTake(
		caller: Caller,
		input: Omit<LeaseTake, "walkerId">,
	): Promise<Exclude<LeaseAnswer, { kind: "unreachable" }>>;
	/** Renews the leases of a run the Caller's Device walks. Answers the names it no longer holds. */
	leaseRenew(
		caller: Caller,
		input: { spaceId: string; runId: string; names: readonly string[] },
	): Promise<string[]>;
	/** Lets go of the leases of a run the Caller's Device walks: by name, or all. */
	leaseRelease(
		caller: Caller,
		input: { spaceId: string; runId: string; names?: readonly string[] },
	): Promise<void>;
	/**
	 * Adds a Project to a Space of this Host for the Caller's Person, by its
	 * remote (`PeerProjects.addFromRemote`). Needs `project.add` there.
	 */
	addProject(
		caller: Caller,
		input: { spaceId: string; name: string; remote: string },
	): Promise<{ projectId: string }>;
	/**
	 * Adds a Project without a folder to a Space of this Host for the
	 * Caller's Person (`PeerProjects.defineWithoutFolder`, ADR 22). Needs
	 * `project.add` there.
	 */
	addWithoutFolder(
		caller: Caller,
		input: { spaceId: string; name: string },
	): Promise<{ projectId: string }>;
	/** Records the Device's Clone of a Project in a Space of this Host. */
	addClone(
		caller: Caller,
		input: { spaceId: string; projectId: string; deviceName: string },
	): Promise<void>;
	/**
	 * Makes the Device's Clones in a Space of this Host exactly these
	 * Projects (`PeerProjects.setClones`). Needs `project.add` there.
	 */
	setClones(
		caller: Caller,
		input: {
			spaceId: string;
			projectIds: string[];
			deviceName: string;
			/** A development install (ADR 17). An older Device leaves it out. */
			dev?: boolean | undefined;
			/** The fingerprint of its computer (ADR 20). An older Device leaves it out. */
			machine?: string | undefined;
		},
	): Promise<{ added: string[]; removed: string[] }>;
	/**
	 * Publishes an Offer of the Caller's Device into a Space of this Host (or
	 * its new caps). Needs `offer.make` there; logged in the Caller's
	 * Person's name.
	 */
	offer(
		caller: Caller,
		input: OfferCaps & {
			spaceId: string;
			/** The profile's id. */
			profile: string;
			/** The profile's name. A Device from before ids sends none: its id is its name. */
			profileName?: string;
			deviceName: string;
		},
	): Promise<void>;
	/** Withdraws an Offer of the Caller's Device from a Space of this Host. */
	withdrawOffer(
		caller: Caller,
		input: { spaceId: string; profile: string },
	): Promise<void>;
	/** Keeps a file of a run the Device walks, with its stamp for a step's file (none from an older Walker). */
	archivePut(
		caller: Caller,
		input: { ref: ArchiveRef; content: string; stamp?: CopyStamp },
	): Promise<void>;
	/**
	 * A file of a run of a Space the Caller's Person is a Member of. A copy
	 * of a step's file only when its stamp holds the step as this Host's
	 * log says. Null when there is none.
	 */
	archiveGet(
		caller: Caller,
		input: { ref: ArchiveRef },
	): Promise<string | null>;
	/**
	 * Keeps the content of a knowledge file of a Space this Host keeps, by
	 * its hash (base64). Needs a role that may start runs there.
	 */
	knowledgePut(
		caller: Caller,
		input: KnowledgeRef & { content: string },
	): Promise<void>;
	/**
	 * The content of a knowledge file of a Space this Host keeps and the
	 * Caller's Person is a Member of, in base64. Null when there is none.
	 */
	knowledgeGet(caller: Caller, ref: KnowledgeRef): Promise<string | null>;
	/**
	 * A step's live transcript, for a Member of its run's Space: its
	 * entries after `afterSeq`, then each new one, until the step ends or
	 * the signal aborts.
	 */
	archiveFollow(
		caller: Caller,
		input: { step: FeedStep; afterSeq: number },
		signal?: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/** The Walker sends live entries of a step of a run it walks; `ended`: they are its last. */
	archiveTail(
		caller: Caller,
		input: { step: FeedStep; entries: TranscriptEntry[]; ended: boolean },
	): Promise<void>;
	/**
	 * The relay's work half (`devices.work`): the calls of the runs this
	 * Host walks that are placed on the Caller's Device, and their cancels,
	 * until the signal aborts.
	 */
	work(
		caller: Caller,
		input: { running: string[] },
		signal?: AbortSignal,
	): AsyncIterable<WorkDelivery>;
	/** The Caller's Device answers a call it took. */
	workReply(
		caller: Caller,
		input: { id: string; replies: WorkReply[]; done: boolean },
	): Promise<{ known: boolean }>;
	/**
	 * Starts a run placed on another Device, for the Caller's Person: this
	 * Host walks it. Needs `run.start` in the Space.
	 */
	startRun(
		caller: Caller,
		input: StartRunInput & { spaceId: string },
	): Promise<{ runId: string }>;
	/**
	 * Starts a test run (ADR 27) placed on another Device, for the
	 * Caller's Person, as `startRun` does: this Host reads the pinned
	 * outputs from its own log. A pin whose run has not reached it yet
	 * says to try again in a moment.
	 */
	startTest(
		caller: Caller,
		input: StartRunInput & {
			spaceId: string;
			flowName: string;
			test: TestRunRequest;
		},
	): Promise<{ runId: string }>;
	/** The Caller's Person's Devices for a project: online, with a Clone or not. */
	devices(
		caller: Caller,
		input: { spaceId: string; projectId: string },
	): Promise<OwnDevice[]>;
	/**
	 * The Walker → Host → Device leg: a call of a run the Caller's Device
	 * walks, for one of its Person's Devices (or this Host), relayed (or
	 * served here), with its replies, until the signal aborts.
	 */
	call(
		caller: Caller,
		input: { deviceId: string; request: WorkRequest },
		signal?: AbortSignal,
	): AsyncIterable<WorkReply>;
	/** Whether one of the Caller's Person's Devices (or this Host) takes work now. */
	reachable(caller: Caller, input: { deviceId: string }): Promise<boolean>;
	/**
	 * Takes the Projects of the Caller's Device's own personal Space into its
	 * Person's personal Space here: only for a Device whose home Host this
	 * is. Each Project keeps its id, or takes the id of the Project here
	 * with its remote. A remote of a shared Space here moves into that
	 * Space only when the Person chose it. Runs again with the same answer.
	 */
	mergePersonal(
		caller: Caller,
		input: PersonalMergeInput,
	): Promise<PersonalMerge>;
};
