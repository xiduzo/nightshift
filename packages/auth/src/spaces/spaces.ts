import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { Database } from "@nightshift/db";
import {
	invitation,
	member,
	organization,
	session,
	user,
} from "@nightshift/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { claimHostAdmin } from "./members";
import type { Role } from "./roles";

/**
 * Spaces as the organization plugin stores them, read and written straight
 * in the database: what the hooks of `createAuth` and the daemon's start
 * need, without a request.
 *
 * A personal Space has `personal` set and exactly one member, its Person,
 * as owner. Its slug is `personal-<user id>`, so the migration that made
 * the first ones and `ensurePersonalSpace` agree on it.
 */

export type Space = {
	id: string;
	name: string;
	personal: boolean;
	role: Role;
};

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

/** The id of the Person's personal Space, or null. */
export async function personalSpaceId(
	db: Database,
	userId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ id: organization.id })
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(and(eq(member.userId, userId), eq(organization.personal, true)))
		.limit(1);
	return row?.id ?? null;
}

/** The Person's personal Space: made with its owner membership when there is none. */
export async function ensurePersonalSpace(
	db: Database,
	userId: string,
): Promise<string> {
	const found = await personalSpaceId(db, userId);
	if (found) return found;
	const id = randomUUID();
	const createdAt = new Date();
	await db.batch([
		db.insert(organization).values({
			id,
			name: personalSpaceName(),
			slug: `personal-${userId}`,
			personal: true,
			createdAt,
		}),
		db.insert(member).values({
			id: randomUUID(),
			organizationId: id,
			userId,
			role: "owner",
			createdAt,
		}),
	]);
	return id;
}

/** The Spaces the Person is a member of, the personal one first, then by name. */
export async function spacesOf(db: Database, userId: string): Promise<Space[]> {
	const rows = await db
		.select({
			id: organization.id,
			name: organization.name,
			personal: organization.personal,
			role: member.role,
		})
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(eq(member.userId, userId))
		.orderBy(desc(organization.personal), asc(organization.name));
	return rows.map((row) => ({ ...row, role: row.role as Role }));
}

/** The Person's role in the Space, or null when they are not a member. */
export async function roleIn(
	db: Database,
	userId: string,
	spaceId: string,
): Promise<Role | null> {
	const [row] = await db
		.select({ role: member.role })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.organizationId, spaceId)))
		.limit(1);
	return (row?.role as Role | undefined) ?? null;
}

/**
 * The Space a session works in: its active Space when the Person is still
 * a member of it, else their personal Space.
 */
export async function activeSpaceId(
	db: Database,
	session: { userId: string; activeOrganizationId?: string | null },
): Promise<string> {
	const active = session.activeOrganizationId;
	if (active && (await roleIn(db, session.userId, active))) return active;
	return ensurePersonalSpace(db, session.userId);
}

/**
 * The Person who owns this computer's Device: the one Night Shift signs in
 * for you on this computer. The migration that added Spaces names one; a
 * database without one gets a new Person here. A blank name becomes the
 * name of the computer's account. A new Person is the Host admin when the
 * Host has none.
 *
 * `self` is this computer's Device row, which auth does not own: the
 * Person it names, and how to name another (`setSelfOwner` of `@nightshift/devices`).
 * Without it, the Person is the one with the local email.
 */
export async function localPerson(
	db: Database,
	self: OwnedDevice = UNOWNED,
): Promise<{ userId: string; spaceId: string }> {
	const name = localName();
	let [person] = self.ownerId
		? await db.select().from(user).where(eq(user.id, self.ownerId))
		: [];
	if (!person) {
		[person] = await db.select().from(user).where(eq(user.email, LOCAL_EMAIL));
	}
	let userId = person?.id;
	if (!userId) {
		userId = randomUUID();
		await db
			.insert(user)
			.values({ id: userId, name, email: LOCAL_EMAIL, role: "user" });
		// The first Person on a Host is its admin.
		await claimHostAdmin(db, userId);
	}
	if (self.ownerId !== userId) await self.setOwner(userId);
	if (person && person.name.trim() === "") {
		await db.update(user).set({ name }).where(eq(user.id, userId));
	}
	return { userId, spaceId: await ensurePersonalSpace(db, userId) };
}

/** This computer's Device as `localPerson` sees it: whom it names as its owner. */
export type OwnedDevice = {
	ownerId: string | null;
	/** Names the Person who owns this computer's Device. */
	setOwner(personId: string): Promise<void>;
};

/** A Device that names nobody and keeps no owner. */
const UNOWNED: OwnedDevice = { ownerId: null, setOwner: async () => {} };

function localName(): string {
	try {
		return userInfo().username || "You";
	} catch {
		return "You";
	}
}

/** Whether a Space of that id exists on this Replica. */
export async function spaceExists(
	db: Database,
	spaceId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.id, spaceId));
	return row !== undefined;
}

/** The id of every Space on this Replica. */
export async function spaceIds(db: Database): Promise<string[]> {
	const rows = await db.select({ id: organization.id }).from(organization);
	return rows.map((row) => row.id);
}

/**
 * The id of the Person's personal Space by its slug (`personal-<user id>`),
 * or null. Unlike `personalSpaceId`, it needs no membership row: a Host
 * finds the personal Space of a Device's owner this way.
 */
export async function personalSpaceIdBySlug(
	db: Database,
	userId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.slug, `personal-${userId}`));
	return row?.id ?? null;
}

/**
 * Keeps a Space that a Host lists as this Replica's copy: makes its row
 * (slug `host-<id>`), or gives the row the Host's name.
 */
export async function mirrorHostSpace(
	db: Database,
	space: { id: string; name: string },
): Promise<void> {
	await db
		.insert(organization)
		.values({
			id: space.id,
			name: space.name,
			slug: `host-${space.id}`,
			createdAt: new Date(),
		})
		.onConflictDoUpdate({
			target: organization.id,
			set: { name: space.name },
		});
}

/**
 * The statements that make `to` the Person's personal Space in place of
 * `from`, for the `db.batch` that moves the rows of `from` into `to` (ADR
 * 1: one personal Space per Home Host). `to` is the Space this Replica
 * keeps a copy of, the one the Person's Home Host keeps as theirs.
 *
 * `to` becomes the Person's personal Space, named "Personal", with the
 * Person as its owner here. A session that worked in `from` works in
 * `to`. `from` goes, with its members and invitations: its rows are in
 * `to` now. Throws when `from` is not the Person's personal Space.
 */
export async function adoptPersonalSpaceBatch(
	db: Database,
	input: { personId: string; from: string; to: string },
): Promise<[BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]> {
	const { personId, from, to } = input;
	if ((await personalSpaceId(db, personId)) !== from) {
		throw new Error(
			`The Space ${from} is not the personal Space of ${personId}.`,
		);
	}
	if (from === to) throw new Error("A Space cannot take its own place.");
	if (!(await spaceExists(db, to))) {
		throw new Error(`The Space ${to} is not on this Replica.`);
	}
	const [membership] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, to), eq(member.userId, personId)));
	return [
		membership
			? db
					.update(member)
					.set({ role: "owner" })
					.where(eq(member.id, membership.id))
			: db.insert(member).values({
					id: randomUUID(),
					organizationId: to,
					userId: personId,
					role: "owner",
					createdAt: new Date(),
				}),
		db
			.update(organization)
			.set({ personal: true, name: personalSpaceName() })
			.where(eq(organization.id, to)),
		db
			.update(session)
			.set({ activeOrganizationId: to })
			.where(eq(session.activeOrganizationId, from)),
		db.delete(invitation).where(eq(invitation.organizationId, from)),
		db.delete(member).where(eq(member.organizationId, from)),
		db.delete(organization).where(eq(organization.id, from)),
	];
}

/**
 * The statements that give the Person a new personal Space `to` of this
 * Replica's own in place of `from`, the personal Space their Home Host
 * keeps, for the `db.batch` that moves the rows this Device takes along
 * (ADR 1: leaving keeps a copy). The reverse of `adoptPersonalSpaceBatch`.
 *
 * `to` is made, named "Personal", with the Person as its owner. A session
 * that worked in `from` works in `to`. `from` stays, with the rows that
 * do not come along, as the Host's Space: it is no longer personal here,
 * it takes the name "Personal on <Host>" (`hostName`), and the Person is
 * no longer a Member of it here.
 * Throws when `from` is not the Person's personal Space, or `to` exists.
 */
export async function splitPersonalSpaceBatch(
	db: Database,
	input: { personId: string; from: string; to: string; hostName: string },
): Promise<[BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]> {
	const { personId, from, to, hostName } = input;
	if ((await personalSpaceId(db, personId)) !== from) {
		throw new Error(
			`The Space ${from} is not the personal Space of ${personId}.`,
		);
	}
	if (await spaceExists(db, to)) {
		throw new Error(`The Space ${to} is on this Replica already.`);
	}
	// The slug of a personal Space, unless an older Space still has it.
	const slug = `personal-${personId}`;
	const [taken] = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.slug, slug));
	const createdAt = new Date();
	return [
		db.insert(organization).values({
			id: to,
			name: personalSpaceName(),
			slug: taken ? `${slug}-${to}` : slug,
			personal: true,
			createdAt,
		}),
		db.insert(member).values({
			id: randomUUID(),
			organizationId: to,
			userId: personId,
			role: "owner",
			createdAt,
		}),
		db
			.update(organization)
			.set({ personal: false, name: personalSpaceName(hostName) })
			.where(eq(organization.id, from)),
		db
			.delete(member)
			.where(and(eq(member.organizationId, from), eq(member.userId, personId))),
		db
			.update(session)
			.set({ activeOrganizationId: to })
			.where(eq(session.activeOrganizationId, from)),
	];
}
