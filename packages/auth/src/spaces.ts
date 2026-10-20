import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import type { Database } from "@nightshift/db";
import { device, member, organization, user } from "@nightshift/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";

import type { Role } from "./access";
import { claimHostAdmin } from "./members";

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
	await db.transaction(async (tx) => {
		await tx.insert(organization).values({
			id,
			name: "Personal",
			slug: `personal-${userId}`,
			personal: true,
			createdAt,
		});
		await tx.insert(member).values({
			id: randomUUID(),
			organizationId: id,
			userId,
			role: "owner",
			createdAt,
		});
	});
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
 */
export async function localPerson(
	db: Database,
): Promise<{ userId: string; spaceId: string }> {
	const [self] = await db
		.select({ id: device.id, ownerId: device.ownerId })
		.from(device)
		.where(eq(device.self, true));
	if (!self) throw new Error("This computer has no Device row yet.");
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
	if (self.ownerId !== userId) {
		await db
			.update(device)
			.set({ ownerId: userId })
			.where(eq(device.id, self.id));
	}
	if (person && person.name.trim() === "") {
		await db.update(user).set({ name }).where(eq(user.id, userId));
	}
	return { userId, spaceId: await ensurePersonalSpace(db, userId) };
}

function localName(): string {
	try {
		return userInfo().username || "You";
	} catch {
		return "You";
	}
}
