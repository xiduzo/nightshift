import type { DeviceRows, PeerContext, RowBatch } from "@nightshift/engine";
import type { DeviceRow, JoinRow } from "../domain/paired-device";

/**
 * The driven ports of the registry. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireRegistry`.
 */

/** The `device` rows of this Replica: this computer's own, and on a Host the paired ones. */
export type DeviceStore = {
	/** This computer's row, or null before it has one. */
	self(): Promise<DeviceRow | null>;
	/** The id of this computer's row, or null. */
	selfId(): Promise<string | null>;
	/** The owner of this computer's row: null without a row or an owner. */
	selfOwnerId(): Promise<string | null>;
	/** Makes this computer's row, unless one exists (two first starts at once keep one). */
	addSelf(row: { id: string; name: string; platform: string }): Promise<void>;
	/** Sets the name, and the platform when given, of a row. */
	setFacts(
		id: string,
		facts: { name: string; platform?: string },
	): Promise<void>;
	/** Names the Person who owns a row. */
	setOwner(id: string, personId: string): Promise<void>;
	/**
	 * This install becomes the Device `to`, in one batch: `self` leaves the
	 * row of `row.id`, a row `to` takes `row`'s facts and `self`, then
	 * `engine` (the engine's rows), then the Commands of `row.id` name `to`,
	 * and the row of `row.id` goes.
	 */
	adopt(move: { row: DeviceRow; to: string; engine: RowBatch }): Promise<void>;
	/** A paired Device's row (never this computer's), or null. */
	paired(id: string): Promise<DeviceRow | null>;
	/** Every paired row (never this computer's): its id and owner. */
	pairedOwners(): Promise<{ id: string; ownerId: string | null }[]>;
	/** The statement that records a pairing: the row, its access back on. Nothing runs. */
	joinRows(row: JoinRow): RowBatch;
	/** What a paired Device says of itself: its name, whether dev, its computer (null when dev). */
	describe(
		id: string,
		facts: { name: string; dev: boolean; machine: string | null | undefined },
	): Promise<void>;
	/** The owner's paired row on that computer, other than `exceptId`, not dev: with access first, then seen last. */
	sameMachine(
		ownerId: string,
		machine: string,
		exceptId: string,
	): Promise<DeviceRow | null>;
	/** The owner's paired rows: revoked last, then the newest first. */
	ownedBy(ownerId: string): Promise<DeviceRow[]>;
	/** A paired row was seen at `at`: its id and owner, or null when there is no such row. */
	markSeen(
		id: string,
		at: number,
	): Promise<{ id: string; ownerId: string | null } | null>;
	/** The statement that removes a Device's access at `at`. Nothing runs. */
	revokeRows(id: string, at: number): RowBatch;
	/** Removes a paired row in one batch, after `engine` (the engine's rows of it). */
	forget(id: string, engine: RowBatch): Promise<void>;
	/** The names of these rows, by id. A row this Replica lacks is missing. */
	names(ids: readonly string[]): Promise<Map<string, string>>;
	/** Every row whose access is not removed, with its owner. */
	known(): Promise<{ id: string; name: string; ownerId: string | null }[]>;
	/** The owners of the paired rows with access that joined this computer as their home Host. */
	homePersons(): Promise<string[]>;
};

/**
 * Logs a Device's facts in its owner's personal Space (`PeerContext.logFact`),
 * in one batch with `before` when it is given.
 * @filledBy engine/wire
 */
export type DeviceFacts = {
	log(
		fact: Parameters<PeerContext["logFact"]>[0],
		before?: RowBatch,
	): Promise<void>;
};

/**
 * The engine's event log, as the registry reads it: the latest presence
 * fact of each Device, and the last count of a Walker.
 * @filledBy engine/wire
 */
export type DeviceHistory = Pick<
	PeerContext["history"],
	"devicePresence" | "lastWalkerSeq"
>;

/**
 * The engine's rows that name a Device, as statements for the registry's
 * batch (`PeerContext.deviceRows`).
 * @filledBy engine/wire
 */
export type EngineDeviceRows = DeviceRows;

/**
 * The personal Space of a Person, by its slug (the Person's id), or null.
 * @filledBy auth
 */
export type PersonalSpaces = {
	idOf(personId: string): Promise<string | null>;
};

/**
 * What this computer says of itself, read at each call.
 * @filledBy devices/machine
 */
export type ThisComputer = {
	hostName(): string;
	inContainer(): boolean;
	platform(): string;
	env(): Record<string, string | undefined>;
};
