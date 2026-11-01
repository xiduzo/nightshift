import type { Database } from "@nightshift/db";
import { runLease } from "@nightshift/db/schema";
import { asDate, instant } from "@nightshift/time";
import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import type {
	LeaseAnswer,
	LeaseHolder,
	LeaseHost,
	LeaseTake,
	SpaceLease,
} from "../contract";

/**
 * The leases of the Spaces this Replica keeps (ADR 7): one row per name
 * (`run_lease`). One run holds a name at a time.
 *
 * - A take is one statement: it takes the row when the name is free, when
 *   its holder let it expire, or when the run holds it already (a loop, a
 *   second branch or a called flow of the same run takes it again). Two
 *   takes at once cannot both win.
 * - A row is free once `expires_at` has passed. Its Walker renews it while
 *   the run lives, so it expires only when the run ended without letting
 *   go, or its Device is gone longer than the ttl.
 * - A release removes the run's rows: by name, or all of them. It reads
 *   the run id only, so a row stays the run's whatever its Space.
 */
export type LeaseStore = LeaseHost & {
	/** The leases of the Space that have not expired, by name. */
	list(spaceId: string): Promise<SpaceLease[]>;
};

export function createLeaseStore(deps: {
	db: Database;
	now(): number;
}): LeaseStore {
	const { db } = deps;
	const at = (ms: number) => asDate(ms);

	async function take(
		input: LeaseTake,
	): Promise<Exclude<LeaseAnswer, { kind: "unreachable" }>> {
		const now = deps.now();
		const taken = await db
			.insert(runLease)
			.values({
				spaceId: input.spaceId,
				name: input.name,
				runId: input.runId,
				runTitle: input.runTitle,
				walkerId: input.walkerId,
				takenAt: at(now),
				expiresAt: at(now + input.ttlMs),
				ttlMs: input.ttlMs,
			})
			.onConflictDoUpdate({
				target: [runLease.spaceId, runLease.name],
				set: {
					// The same run keeps the time it first took the lease.
					takenAt: sql`case when ${runLease.runId} = excluded.run_id then ${runLease.takenAt} else excluded.taken_at end`,
					runId: sql`excluded.run_id`,
					runTitle: sql`excluded.run_title`,
					walkerId: sql`excluded.walker_id`,
					expiresAt: sql`excluded.expires_at`,
					ttlMs: sql`excluded.ttl_ms`,
				},
				setWhere: or(
					eq(runLease.runId, input.runId),
					lte(runLease.expiresAt, at(now)),
				),
			})
			.returning({ runId: runLease.runId });
		if (taken.length > 0) return { kind: "held" };
		const [row] = await db
			.select()
			.from(runLease)
			.where(
				and(eq(runLease.spaceId, input.spaceId), eq(runLease.name, input.name)),
			);
		// The holder let go between the two statements: try once more.
		if (!row) return take(input);
		return { kind: "busy", holder: holderOf(row) };
	}

	return {
		take,

		async renew({ runId, names, walkerId }) {
			if (names.length === 0) return [];
			const now = deps.now();
			const renewed = await db
				.update(runLease)
				.set({ expiresAt: sql`${now} + ${runLease.ttlMs}` })
				.where(
					and(
						eq(runLease.runId, runId),
						inArray(runLease.name, [...names]),
						gt(runLease.expiresAt, at(now)),
						walkerId === undefined
							? undefined
							: eq(runLease.walkerId, walkerId),
					),
				)
				.returning({ name: runLease.name });
			const kept = new Set(renewed.map((row) => row.name));
			return names.filter((name) => !kept.has(name));
		},

		async release({ runId, names, walkerId }) {
			if (names?.length === 0) return;
			await db
				.delete(runLease)
				.where(
					and(
						eq(runLease.runId, runId),
						names === undefined
							? undefined
							: inArray(runLease.name, [...names]),
						walkerId === undefined
							? undefined
							: eq(runLease.walkerId, walkerId),
					),
				);
		},

		async list(spaceId) {
			const rows = await db
				.select()
				.from(runLease)
				.where(
					and(
						eq(runLease.spaceId, spaceId),
						gt(runLease.expiresAt, at(deps.now())),
					),
				)
				.orderBy(runLease.name);
			return rows.map((row) => ({
				...holderOf(row),
				spaceId: row.spaceId,
				name: row.name,
				expiresAt: instant(row.expiresAt),
			}));
		},
	};
}

function holderOf(row: typeof runLease.$inferSelect): LeaseHolder {
	return {
		runId: row.runId,
		runTitle: row.runTitle,
		walkerId: row.walkerId,
		since: instant(row.takenAt),
	};
}
