import type { Database } from "@nightshift/db";
import { invitation, organization, user } from "@nightshift/db/schema";
import { asDate, instant } from "@nightshift/time";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Role } from "../../../roles";
import type { InvitationStore } from "../../application/ports";

/** `InvitationStore` over the organization plugin's `invitation` table. `wireMembers` builds it. */
export function drizzleInvitationStore(db: Database): InvitationStore {
	return {
		async isOpen({ id, email, now }) {
			const [found] = await db
				.select({ id: invitation.id })
				.from(invitation)
				.where(
					and(
						eq(invitation.id, id),
						eq(invitation.status, "pending"),
						gt(invitation.expiresAt, asDate(now)),
						eq(sql`lower(${invitation.email})`, email),
					),
				)
				.limit(1);
			return found !== undefined;
		},
		async find(id) {
			const [row] = await db
				.select({
					id: invitation.id,
					email: invitation.email,
					role: invitation.role,
					status: invitation.status,
					expiresAt: invitation.expiresAt,
					spaceName: organization.name,
					inviterName: user.name,
				})
				.from(invitation)
				.innerJoin(organization, eq(organization.id, invitation.organizationId))
				.innerJoin(user, eq(user.id, invitation.inviterId))
				.where(eq(invitation.id, id))
				.limit(1);
			if (!row) return null;
			return {
				...row,
				role: (row.role ?? "member") as Role,
				expiresAt: instant(row.expiresAt),
			};
		},
		async pendingOf(spaceId, now) {
			const rows = await db
				.select({
					id: invitation.id,
					email: invitation.email,
					role: invitation.role,
					inviterName: user.name,
					expiresAt: invitation.expiresAt,
				})
				.from(invitation)
				.innerJoin(user, eq(user.id, invitation.inviterId))
				.where(
					and(
						eq(invitation.organizationId, spaceId),
						eq(invitation.status, "pending"),
						gt(invitation.expiresAt, asDate(now)),
					),
				)
				.orderBy(invitation.createdAt);
			return rows.map((row) => ({
				...row,
				role: (row.role ?? "member") as Role,
				expiresAt: instant(row.expiresAt),
			}));
		},
	};
}
