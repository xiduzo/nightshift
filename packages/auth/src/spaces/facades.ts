import type { Database } from "@nightshift/db";
import { now as timeNow } from "@nightshift/time";
import type { BatchItem } from "drizzle-orm/batch";
import type { Space } from "./application/list-spaces";
import type { InvitationView, PendingInvitation, SpaceMember } from "./members";
import { type OwnedDevice, type RowBatch, UNOWNED } from "./personal";
import type { Role } from "./roles";
import { wireSpaces } from "./wire";

/**
 * The functions of spaces as their callers know them: each takes the
 * database and calls one bound use case of `wireSpaces`. They go when the
 * callers call the bound use cases (lane A4 of the hexagon series).
 */

export { LOCAL_EMAIL } from "./personal";

const spaces = (db: Database) => wireSpaces({ db });

/** The statements of one `db.batch`, as drizzle types them. */
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/** Whether the Host has a Host admin yet. */
export function hasHostAdmin(db: Database): Promise<boolean> {
	return spaces(db).members.hasHostAdmin();
}

/** Whether the Person is the Host admin. */
export function isHostAdmin(db: Database, personId: string): Promise<boolean> {
	return spaces(db).members.isHostAdmin({ personId });
}

/**
 * Why an email and password sign-up is refused, or null when it may go
 * ahead: the Host's first Person always may. Anyone else needs a pending,
 * unexpired invitation of that email, named by `invitationId`.
 */
export function signUpRefusal(
	db: Database,
	body: { email?: unknown; invitationId?: unknown },
	now = timeNow(),
): Promise<string | null> {
	return spaces(db).members.checkSignUp({ body, now });
}

/** The invitation of that id, or null. The id is the secret of the link. */
export function invitationView(
	db: Database,
	id: string,
	now = timeNow(),
): Promise<InvitationView | null> {
	return spaces(db).members.viewInvitation({ id, now });
}

/** The Space's Members, oldest first, and its pending invitations that have not expired. */
export function membersOf(
	db: Database,
	spaceId: string,
	now = timeNow(),
): Promise<{ members: SpaceMember[]; invitations: PendingInvitation[] }> {
	return spaces(db).members.listMembers({ spaceId, now });
}

/** The Members of a Space by Person: their name and role, in no set order. */
export function spaceRoster(
	db: Database,
	spaceId: string,
): Promise<{ id: string; name: string; role: string }[]> {
	return spaces(db).members.listRoster({ spaceId });
}

/** The Person's membership of the Space (its id and role), or null. */
export function membershipOf(
	db: Database,
	spaceId: string,
	personId: string,
): Promise<{ id: string; role: string } | null> {
	return spaces(db).members.findMembership({ spaceId, personId });
}

/** Makes the Person a Member of the Space in that role. */
export function addMembership(
	db: Database,
	input: { spaceId: string; personId: string; role: string },
): Promise<void> {
	return spaces(db).members.addMembership(input);
}

/** Gives a membership another role. */
export function setMembershipRole(
	db: Database,
	membershipId: string,
	role: string,
): Promise<void> {
	return spaces(db).members.setMembershipRole({ membershipId, role });
}

/** Ends the Person's memberships of these Spaces. */
export function removeMemberships(
	db: Database,
	spaceIds: readonly string[],
	personId: string,
): Promise<void> {
	return spaces(db).members.removeMemberships({ spaceIds, personId });
}

/** The names of these Persons, by id. A Person this Replica does not know is missing. */
export function personNames(
	db: Database,
	ids: readonly string[],
): Promise<Map<string, string>> {
	return spaces(db).members.listPersonNames({ ids });
}

/** The name and email of a Person, or null for one this Replica does not know. */
export function personContact(
	db: Database,
	personId: string,
): Promise<{ name: string; email: string } | null> {
	return spaces(db).members.findPersonContact({ personId });
}

/** The id of the Person's personal Space, or null. */
export function personalSpaceId(
	db: Database,
	userId: string,
): Promise<string | null> {
	return spaces(db).personal.findPersonalSpace({ personId: userId });
}

/**
 * The id of the Person's personal Space by its slug (`personal-<user id>`),
 * or null. Unlike `personalSpaceId`, it needs no membership row.
 */
export function personalSpaceIdBySlug(
	db: Database,
	userId: string,
): Promise<string | null> {
	return spaces(db).personal.findPersonalSpaceBySlug({ personId: userId });
}

/** The Person's personal Space: made with its owner membership when there is none. */
export function ensurePersonalSpace(
	db: Database,
	userId: string,
): Promise<string> {
	return spaces(db).personal.ensurePersonalSpace({ personId: userId });
}

/**
 * The Person who owns this computer's Device, and their personal Space.
 * `self` is this computer's Device row: the Person it names, and how to
 * name another (`setSelfOwner` of `@nightshift/devices`).
 */
export function localPerson(
	db: Database,
	self: OwnedDevice = UNOWNED,
): Promise<{ userId: string; spaceId: string }> {
	return spaces(db).personal.findLocalPerson({ self });
}

/**
 * The statements that make `to` the Person's personal Space in place of
 * `from`, for the `db.batch` that moves the rows of `from` into `to`.
 * Throws when `from` is not the Person's personal Space.
 */
export async function adoptPersonalSpaceBatch(
	db: Database,
	input: { personId: string; from: string; to: string },
): Promise<Batch> {
	return asBatch(await spaces(db).personal.adoptPersonalSpace(input));
}

/**
 * The statements that give the Person a new personal Space `to` of this
 * Replica's own in place of `from`, for the `db.batch` that moves the rows
 * this Device takes along. Throws when `from` is not the Person's personal
 * Space, or `to` exists.
 */
export async function splitPersonalSpaceBatch(
	db: Database,
	input: { personId: string; from: string; to: string; hostName: string },
): Promise<Batch> {
	return asBatch(await spaces(db).personal.splitPersonalSpace(input));
}

/** The Spaces the Person is a member of, the personal one first, then by name. */
export function spacesOf(db: Database, userId: string): Promise<Space[]> {
	return spaces(db).listSpaces({ personId: userId });
}

/** The Person's role in the Space, or null when they are not a member. */
export function roleIn(
	db: Database,
	userId: string,
	spaceId: string,
): Promise<Role | null> {
	return spaces(db).findRole({ personId: userId, spaceId });
}

/**
 * The Space a session works in: its active Space when the Person is still
 * a member of it, else their personal Space.
 */
export function activeSpaceId(
	db: Database,
	session: { userId: string; activeOrganizationId?: string | null },
): Promise<string> {
	return spaces(db).findActiveSpace({
		personId: session.userId,
		activeSpaceId: session.activeOrganizationId,
	});
}

/** Whether a Space of that id exists on this Replica. */
export function spaceExists(db: Database, spaceId: string): Promise<boolean> {
	return spaces(db).hasSpace({ spaceId });
}

/** The id of every Space on this Replica. */
export function spaceIds(db: Database): Promise<string[]> {
	return spaces(db).listSpaceIds();
}

/**
 * Keeps a Space that a Host lists as this Replica's copy: makes its row
 * (slug `host-<id>`), or gives the row the Host's name.
 */
export function mirrorHostSpace(
	db: Database,
	space: { id: string; name: string },
): Promise<void> {
	return spaces(db).mirrorHostSpace(space);
}

/** The drizzle statements of the adapter that made `rows`. */
function asBatch(rows: RowBatch): Batch {
	return rows as unknown as Batch;
}
