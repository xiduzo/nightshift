import type { Database } from "@nightshift/db";
import {
	invitation,
	member,
	organization,
	session,
} from "@nightshift/db/schema";
import { asDate } from "@nightshift/time";
import { and, eq } from "drizzle-orm";
import type { PersonalSpaceStore } from "../../application/ports";
import type { RowBatch } from "../../domain/personal-space";

/**
 * `PersonalSpaceStore` over the organization plugin's tables. Its row
 * batches are drizzle statements for the caller's `db.batch`.
 * `wirePersonal` builds it.
 */
export function drizzlePersonalSpaceStore(db: Database): PersonalSpaceStore {
	return {
		async personalSpaceId(personId) {
			const [row] = await db
				.select({ id: organization.id })
				.from(organization)
				.innerJoin(member, eq(member.organizationId, organization.id))
				.where(
					and(eq(member.userId, personId), eq(organization.personal, true)),
				)
				.limit(1);
			return row?.id ?? null;
		},
		async spaceIdBySlug(slug) {
			const [row] = await db
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.slug, slug));
			return row?.id ?? null;
		},
		async exists(spaceId) {
			const [row] = await db
				.select({ id: organization.id })
				.from(organization)
				.where(eq(organization.id, spaceId));
			return row !== undefined;
		},
		async membershipId(spaceId, personId) {
			const [membership] = await db
				.select({ id: member.id })
				.from(member)
				.where(
					and(eq(member.organizationId, spaceId), eq(member.userId, personId)),
				);
			return membership?.id ?? null;
		},
		async create(space) {
			const createdAt = asDate();
			await db.batch([
				db.insert(organization).values({
					id: space.id,
					name: space.name,
					slug: space.slug,
					personal: true,
					createdAt,
				}),
				db.insert(member).values({
					id: space.membershipId,
					organizationId: space.id,
					userId: space.personId,
					role: "owner",
					createdAt,
				}),
			]);
		},
		adoptRows({ personId, from, to, name, membershipId, newMembershipId }) {
			return [
				membershipId
					? db
							.update(member)
							.set({ role: "owner" })
							.where(eq(member.id, membershipId))
					: db.insert(member).values({
							id: newMembershipId,
							organizationId: to,
							userId: personId,
							role: "owner",
							createdAt: asDate(),
						}),
				db
					.update(organization)
					.set({ personal: true, name })
					.where(eq(organization.id, to)),
				db
					.update(session)
					.set({ activeOrganizationId: to })
					.where(eq(session.activeOrganizationId, from)),
				db.delete(invitation).where(eq(invitation.organizationId, from)),
				db.delete(member).where(eq(member.organizationId, from)),
				db.delete(organization).where(eq(organization.id, from)),
			] as unknown as RowBatch;
		},
		splitRows({ personId, from, to, name, slug, membershipId, fromName }) {
			const createdAt = asDate();
			return [
				db.insert(organization).values({
					id: to,
					name,
					slug,
					personal: true,
					createdAt,
				}),
				db.insert(member).values({
					id: membershipId,
					organizationId: to,
					userId: personId,
					role: "owner",
					createdAt,
				}),
				db
					.update(organization)
					.set({ personal: false, name: fromName })
					.where(eq(organization.id, from)),
				db
					.delete(member)
					.where(
						and(eq(member.organizationId, from), eq(member.userId, personId)),
					),
				db
					.update(session)
					.set({ activeOrganizationId: to })
					.where(eq(session.activeOrganizationId, from)),
			] as unknown as RowBatch;
		},
	};
}
