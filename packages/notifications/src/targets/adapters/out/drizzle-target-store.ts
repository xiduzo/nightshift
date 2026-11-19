import type { Database } from "@nightshift/db";
import { pushTarget } from "@nightshift/db/schema";
import { asDate, instant, instantOrNull } from "@nightshift/time";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { TargetStore } from "../../application/ports";
import { type PushTarget, pushKindSchema } from "../../domain/push-targets";

/**
 * `TargetStore` over drizzle: one row per push target in `push_target`,
 * one per endpoint of a Person. The keys are JSON text. `wireTargets`
 * builds it.
 */
export function drizzleTargetStore(db: Database): TargetStore {
	function toTarget(row: typeof pushTarget.$inferSelect): PushTarget {
		return {
			id: row.id,
			personId: row.personId,
			kind: pushKindSchema.catch("web").parse(row.kind),
			name: row.name,
			platform: row.platform,
			endpoint: row.endpoint,
			keys: row.keys ? (JSON.parse(row.keys) as Record<string, string>) : null,
			sessionId: row.sessionId,
			createdAt: instant(row.createdAt),
			lastSeenAt: instantOrNull(row.lastSeenAt),
		};
	}

	return {
		async of(personId) {
			const rows = await db
				.select()
				.from(pushTarget)
				.where(eq(pushTarget.personId, personId))
				.orderBy(pushTarget.createdAt);
			return rows.map(toTarget);
		},
		async byIds(ids) {
			if (ids.length === 0) return [];
			const rows = await db
				.select()
				.from(pushTarget)
				.where(inArray(pushTarget.id, [...ids]));
			return rows.map(toTarget);
		},
		async dropPhoneOfOthers(personId, endpoint) {
			await db
				.delete(pushTarget)
				.where(
					and(
						eq(pushTarget.endpoint, endpoint),
						eq(pushTarget.kind, "expo"),
						ne(pushTarget.personId, personId),
					),
				);
		},
		async upsert(target) {
			const at = asDate(target.at);
			const keys = target.keys ? JSON.stringify(target.keys) : null;
			const [row] = await db
				.insert(pushTarget)
				.values({
					id: target.id,
					personId: target.personId,
					kind: target.kind,
					name: target.name,
					platform: target.platform,
					endpoint: target.endpoint,
					keys,
					sessionId: target.sessionId,
					createdAt: at,
					lastSeenAt: at,
				})
				.onConflictDoUpdate({
					target: [pushTarget.personId, pushTarget.endpoint],
					set: {
						kind: target.kind,
						name: target.name,
						platform: target.platform,
						keys,
						sessionId: target.sessionId,
						lastSeenAt: at,
					},
				})
				.returning();
			return row ? toTarget(row) : null;
		},
		async remove(personId, id) {
			const [row] = await db
				.delete(pushTarget)
				.where(and(eq(pushTarget.id, id), eq(pushTarget.personId, personId)))
				.returning();
			return row ? toTarget(row) : null;
		},
		async forget(ids) {
			if (ids.length === 0) return;
			await db.delete(pushTarget).where(inArray(pushTarget.id, [...ids]));
		},
	};
}
