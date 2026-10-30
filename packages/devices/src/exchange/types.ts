import type { DeviceKeyAccess } from "@nightshift/auth";
import type {
	CopyStamp,
	FeedStep,
	OwnDevice,
	RunCommandInput,
	StartRunInput,
	TranscriptEntry,
} from "@nightshift/engine";
import type {
	ArchiveRef,
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
 * call carries the Device key; the Host filters by its Person's membership
 * and never lets a Device write a row of another Walker.
 *
 * Refusals are ORPCErrors: UNAUTHORIZED (the Device has no access),
 * FORBIDDEN (it may not do this), CONFLICT (not yet: try again later).
 * Any other error is a failure written for people.
 */
export type HostExchange = {
	/** Rows of the Spaces the key's Person is a Member of, after the cursors, but the Device's own. */
	pull(key: DeviceKeyAccess, cursors: SyncCursors): Promise<SyncBatch>;
	/**
	 * The same, then every new batch as rows land, until the signal
	 * aborts. `commands: false` leaves the Commands out: the Device takes
	 * them from `commands`.
	 */
	stream(
		key: DeviceKeyAccess,
		input: { cursors: SyncCursors; commands?: boolean },
		signal?: AbortSignal,
	): AsyncIterable<SyncBatch>;
	/**
	 * The Commands that wait for the key's Device, the whole set, then
	 * again each time it changes, until the signal aborts.
	 */
	commands(
		key: DeviceKeyAccess,
		signal?: AbortSignal,
	): AsyncIterable<CommandBatch>;
	/** Takes the Device's own rows. Refuses a batch with a row of another Walker or Space. */
	push(key: DeviceKeyAccess, rows: RunRows): Promise<{ events: number }>;
	/** A person's action on a run another Device walks, in the name of the key's Person. */
	command(
		key: DeviceKeyAccess,
		input: RunCommandInput & { runId: string },
	): Promise<void>;
	/** The Walker applied a command, or says why not. */
	commandDone(
		key: DeviceKeyAccess,
		input: { id: string; error: string | null },
	): Promise<void>;
	/** Records the Device's Clone of a Project in a Space of this Host. */
	addClone(
		key: DeviceKeyAccess,
		input: { spaceId: string; projectId: string; deviceName: string },
	): Promise<void>;
	/**
	 * Publishes an Offer of the key's Device into a Space of this Host (or
	 * its new caps). Needs `offer.make` there; logged in the key's
	 * Person's name.
	 */
	offer(
		key: DeviceKeyAccess,
		input: OfferCaps & {
			spaceId: string;
			/** The profile's id. */
			profile: string;
			/** The profile's name. A Device from before ids sends none: its id is its name. */
			profileName?: string;
			deviceName: string;
		},
	): Promise<void>;
	/** Withdraws an Offer of the key's Device from a Space of this Host. */
	withdrawOffer(
		key: DeviceKeyAccess,
		input: { spaceId: string; profile: string },
	): Promise<void>;
	/** Keeps a file of a run the Device walks, with its stamp for a step's file (none from an older Walker). */
	archivePut(
		key: DeviceKeyAccess,
		ref: ArchiveRef,
		content: string,
		stamp?: CopyStamp,
	): Promise<void>;
	/**
	 * A file of a run of a Space the key's Person is a Member of. A copy
	 * of a step's file only when its stamp holds the step as this Host's
	 * log says. Null when there is none.
	 */
	archiveGet(key: DeviceKeyAccess, ref: ArchiveRef): Promise<string | null>;
	/**
	 * Keeps the content of a knowledge file of a Space this Host keeps, by
	 * its hash (base64). Needs a role that may start runs there.
	 */
	knowledgePut(
		key: DeviceKeyAccess,
		input: KnowledgeRef & { content: string },
	): Promise<void>;
	/**
	 * The content of a knowledge file of a Space this Host keeps and the
	 * key's Person is a Member of, in base64. Null when there is none.
	 */
	knowledgeGet(key: DeviceKeyAccess, ref: KnowledgeRef): Promise<string | null>;
	/**
	 * A step's live transcript, for a Member of its run's Space: its
	 * entries after `afterSeq`, then each new one, until the step ends or
	 * the signal aborts.
	 */
	archiveFollow(
		key: DeviceKeyAccess,
		input: { step: FeedStep; afterSeq: number },
		signal?: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/** The Walker sends live entries of a step of a run it walks; `ended`: they are its last. */
	archiveTail(
		key: DeviceKeyAccess,
		input: { step: FeedStep; entries: TranscriptEntry[]; ended: boolean },
	): Promise<void>;
	/**
	 * The relay's work half (`devices.work`): the calls of the runs this
	 * Host walks that are placed on the key's Device, and their cancels,
	 * until the signal aborts.
	 */
	work(
		key: DeviceKeyAccess,
		input: { running: string[] },
		signal?: AbortSignal,
	): AsyncIterable<WorkDelivery>;
	/** The key's Device answers a call it took. */
	workReply(
		key: DeviceKeyAccess,
		input: { id: string; replies: WorkReply[]; done: boolean },
	): Promise<{ known: boolean }>;
	/**
	 * Starts a run placed on another Device, for the key's Person: this
	 * Host walks it. Needs `run.start` in the Space.
	 */
	startRun(
		key: DeviceKeyAccess,
		input: StartRunInput & { spaceId: string; deviceId: string },
	): Promise<{ runId: string }>;
	/** The key's Person's Devices for a project: online, with a Clone or not. */
	devices(
		key: DeviceKeyAccess,
		input: { spaceId: string; projectId: string },
	): Promise<OwnDevice[]>;
	/**
	 * The Walker → Host → Device leg: a call of a run the key's Device
	 * walks, for one of its Person's Devices (or this Host), relayed (or
	 * served here), with its replies, until the signal aborts.
	 */
	call(
		key: DeviceKeyAccess,
		input: { deviceId: string; request: WorkRequest },
		signal?: AbortSignal,
	): AsyncIterable<WorkReply>;
	/** Whether one of the key's Person's Devices (or this Host) takes work now. */
	reachable(key: DeviceKeyAccess, deviceId: string): Promise<boolean>;
	/**
	 * Takes the Projects of the key's Device's own personal Space into its
	 * Person's personal Space here: only for a Device whose home Host this
	 * is. Each Project keeps its id, or takes the id of the Project here
	 * with its remote. A remote of a shared Space here moves into that
	 * Space only when the Person chose it. Runs again with the same answer.
	 */
	mergePersonal(
		key: DeviceKeyAccess,
		input: PersonalMergeInput,
	): Promise<PersonalMerge>;
};
