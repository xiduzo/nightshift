/**
 * A Person's personal Space. It has `personal` set and exactly one member,
 * its Person, as owner. Its slug is `personal-<user id>`, so the migration
 * that made the first ones and `ensurePersonalSpace` agree on it.
 */

/** The email of the Person Night Shift makes for this computer. Never a mailbox. */
export const LOCAL_EMAIL = "local@nightshift.invalid";

/**
 * The name of a personal Space on this Replica (ADR 1): "Personal" for
 * the Person's own, and "Personal on <Host>" for one that Host keeps
 * that is not theirs here (`keptBy`: the Host's name). The one place
 * these names are decided: every writer of a personal Space's name asks
 * here.
 */
export function personalSpaceName(keptBy?: string): string {
	return keptBy === undefined ? "Personal" : `Personal on ${keptBy}`;
}

/** The slug of the Person's personal Space. */
export function personalSlug(personId: string): string {
	return `personal-${personId}`;
}

/** This computer's Device as `localPerson` sees it: whom it names as its owner. */
export type OwnedDevice = {
	ownerId: string | null;
	/** Names the Person who owns this computer's Device. */
	setOwner(personId: string): Promise<void>;
};

declare const rows: unique symbol;

/**
 * The statements of one `db.batch`, opaque outside the database adapter
 * that makes them. The caller runs them with the rows it moves.
 */
export type RowBatch = readonly [unknown, ...unknown[]] & {
	readonly [rows]: true;
};

/** Why a Space cannot take the place of the Person's personal Space. */
export const notPersonal = (spaceId: string, personId: string) =>
	`The Space ${spaceId} is not the personal Space of ${personId}.`;
export const OWN_PLACE = "A Space cannot take its own place.";
export const notHere = (spaceId: string) =>
	`The Space ${spaceId} is not on this Replica.`;
export const hereAlready = (spaceId: string) =>
	`The Space ${spaceId} is on this Replica already.`;
