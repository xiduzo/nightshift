import type { Actor, RowBatch } from "@nightshift/engine";
import type { DeviceCopies } from "@nightshift/engine/settings";
import type {
	MergeRow,
	MergeTarget,
	SplitRow,
	Unfinished,
} from "../domain/membership-rows";

/**
 * The driven ports of membership. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireMembership`.
 */

/**
 * The `space_merge` and `space_split` rows: one step at a time, so a crash
 * never leaves a move half done.
 */
export type MembershipRecord = {
	/** The step that started and is not done, if any. A split comes first. */
	unfinished(): Promise<Unfinished | null>;
	merges: {
		/** The latest merge, done or not. */
		latest(): Promise<MergeRow | null>;
		/** A new merge, planned: its copy of the database is made. */
		plan(input: {
			fromSpace: string;
			hostId: string;
			personId: string;
			joined: readonly string[];
			backup: string;
		}): Promise<MergeRow>;
		/** The Host took the Projects: where each one goes. */
		mapped(
			fromSpace: string,
			input: {
				toSpace: string;
				projectMap: Record<string, MergeTarget>;
				personMap: Record<string, string>;
			},
		): Promise<void>;
		/**
		 * The statements that mark the merge moved: they go in the batch that
		 * moves the rows.
		 */
		moved(fromSpace: string): RowBatch;
		/**
		 * The statements that end a merge that is not done, when this
		 * computer leaves its home Host.
		 */
		abandon(): RowBatch;
		/** The Host has the moved runs. */
		pushed(fromSpace: string): Promise<void>;
	};
	splits: {
		/** The latest split of that Space, done or not. */
		of(fromSpace: string): Promise<SplitRow | null>;
		/** A new split, planned: its copy of the database is made. */
		plan(
			input: Omit<SplitRow, "state" | "projects" | "runs" | "unpinned">,
		): Promise<SplitRow>;
		/**
		 * The statements that mark the split moved: they go in the batch that
		 * moves the rows.
		 */
		moved(
			toSpace: string,
			input: {
				projects: readonly string[];
				runs: number;
				unpinned: number;
			},
		): RowBatch;
		/** The new Space's document has its Projects. */
		done(toSpace: string): Promise<void>;
	};
};

/**
 * A copy of the whole database before a merge or a leave changes it.
 */
export type DatabaseCopy = {
	copy(
		dataDir: string,
		at: number,
		before?: "personal-merge" | "leaving-host",
	): Promise<string>;
};

/**
 * The Person's personal Space and the auth batches that adopt or split it.
 * @filledBy auth
 */
export type PersonalSpaces = {
	/** The Person's personal Space id, or null. */
	personalId(personId: string): Promise<string | null>;
	/** Whether that Space row still exists. */
	exists(spaceId: string): Promise<boolean>;
	/** The statements that make the Host's Space this computer's Personal. */
	adoptBatch(input: {
		personId: string;
		from: string;
		to: string;
	}): Promise<RowBatch>;
	/** The statements that split Personal off the Host's Space. */
	splitBatch(input: {
		personId: string;
		from: string;
		to: string;
		hostName: string;
	}): Promise<RowBatch>;
};

/**
 * Whether this computer keeps paired Devices as a Host.
 * @filledBy devices/devices
 */
export type PairedDevices = {
	/** True when at least one paired Device still has access. */
	hasPaired(): Promise<boolean>;
};

/**
 * Waits a short while (tests set a fake).
 * @filledBy devices/wire
 */
export type Wait = {
	sleep(ms: number): Promise<void>;
};

/**
 * Fresh ids for a new Space.
 * @filledBy devices/wire
 */
export type Ids = {
	spaceId(): string;
};

/**
 * Runs one opaque `RowBatch`.
 * @filledBy devices/wire
 */
export type Batches = {
	run(batch: RowBatch): Promise<void>;
};

/**
 * The Night Shift actor and Host-unreachable check the merge uses.
 * @filledBy devices/wire
 */
export type EngineKernel = {
	/** The system actor for Space reads during a merge or split. */
	nightShift: Actor;
	/** Whether an error means the Host did not answer. */
	isHostUnreachable(error: unknown): boolean;
};

/**
 * The copies of the Person's other Devices on this computer.
 * @filledBy engine/settings
 */
export type DeviceCopiesPort = Pick<DeviceCopies, "keep">;
