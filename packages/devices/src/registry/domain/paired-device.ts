/**
 * The Devices that paired with this Host: their rows, whether they are
 * online, and the words a person reads of them.
 *
 * Online is derived, never stored: a Device is online while its link
 * answers (`seen`) and for `offlineAfterMs` after. `last_seen_at` is the
 * fact. A Host that starts again starts with every Device offline: a
 * Device whose last word in the log was `DeviceOnline` gets
 * `DeviceOffline`, so the log never says a Device stayed online across a
 * Host that was down. A `bun --hot` reload is no new start: the registry
 * before hands its presence to the next one (`DevicePresence`).
 */

/**
 * Device id → when its link last answered, for the Devices online now. It
 * outlives a registry: the devices runtime hands it to the next engine's
 * registry on a `bun --hot` reload, so a Device online before the reload
 * is online after it, and nothing is logged.
 */
export type DevicePresence = Map<string, number>;

/** A `device` row, with its times as epoch ms. */
export type DeviceRow = {
	id: string;
	name: string;
	platform: string;
	homeHost: string | null;
	lastSeenAt: number | null;
	ownerId: string | null;
	dev: boolean;
	machine: string | null;
	self: boolean;
	createdAt: number;
	revokedAt: number | null;
};

export type PairedDevice = {
	id: string;
	name: string;
	/** A development install: never a default or a fallback (ADR 17). */
	dev?: boolean;
	platform: string;
	/** The Person who approved the pairing: the Device's owner on this Host. */
	ownerId: string;
	/**
	 * The address the Device joined by, when this Host is its home Host
	 * (it keeps the Device's document). Null: a guest Host.
	 */
	homeHost: string | null;
	/** Epoch ms. Null: never answered after the pairing. */
	lastSeenAt: number | null;
	/**
	 * Its Link answers: a hello or a heartbeat in the last
	 * `OFFLINE_AFTER_MS`. What people see (the Devices page, a Space's
	 * devices, `DeviceOnline` and `DeviceOffline`). Whether it takes the
	 * work of a step now is the work hub's `online`.
	 */
	online: boolean;
	pairedAt: number;
	/** Epoch ms when its owner removed its access. */
	revokedAt: number | null;
};

/** What a paired Device is, when it pairs or pairs again. */
export type JoinRow = {
	id: string;
	name: string;
	platform: string;
	ownerId: string;
	homeHost: string | null;
	machine?: string | undefined;
};

/** A paired Device as people see it: its row, and whether it is online now. */
export function toPaired(
	row: DeviceRow,
	online: ReadonlyMap<string, number>,
): PairedDevice {
	return {
		id: row.id,
		name: row.name,
		...(row.dev ? { dev: true } : {}),
		platform: row.platform,
		ownerId: row.ownerId ?? "",
		homeHost: row.homeHost,
		lastSeenAt: row.lastSeenAt,
		online: online.has(row.id),
		pairedAt: row.createdAt,
		revokedAt: row.revokedAt,
	};
}

/** The Devices of `online` silent since `cutoff` or before, in the order they came online. */
export function silentSince(
	online: ReadonlyMap<string, number>,
	cutoff: number,
): string[] {
	return [...online].flatMap(([id, at]) => (at > cutoff ? [] : [id]));
}

/**
 * The personal Space of a Device's owner: where its facts are logged.
 * `idOf` reads it. An owner without one is an error, not a refusal.
 */
export async function spaceOfOwner(
	idOf: (personId: string) => Promise<string | null>,
	ownerId: string | null,
): Promise<string> {
	const found = await idOf(ownerId ?? "");
	if (found === null) throw new Error(NO_PERSONAL_SPACE);
	return found;
}

/** A Device id that is this computer's own. */
export const PAIR_WITH_ITSELF = "A computer cannot pair with itself.";
/** A Device id this Host has no paired row of. */
export const NOT_PAIRED = "This device is not paired with this computer.";
/** A Device to forget that still has access. */
export const REMOVE_ACCESS_FIRST = "Remove the access of this device first.";
/** The owner of a Device has no personal Space to log its facts in. */
export const NO_PERSONAL_SPACE = "The Device's owner has no personal Space.";
/** A pairing whose row the batch did not leave. */
export const NOT_RECORDED = "The Device was not recorded.";
/** This computer has no `self` row yet. */
export const NO_SELF_ROW = "This computer has no Device row yet.";
/** An adoption that must log its place, without a personal Space. */
export const NO_SELF_SPACE = "This computer has no personal Space yet.";
