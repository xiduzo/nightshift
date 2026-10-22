import { randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { pushTarget } from "@nightshift/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

/**
 * The push targets of each Person: the browsers (Web Push), phones (Expo
 * Push) and desktop apps that get notifications while no Night Shift page
 * is open. A phone is one push target plus its session.
 */

/** The kinds of push target, one channel each. */
export const PUSH_KINDS = ["web", "expo", "desktop"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export const pushKindSchema = z.enum(PUSH_KINDS);

/** A screen that gets pushes, as a channel needs it. */
export type PushTarget = {
	id: string;
	personId: string;
	kind: PushKind;
	name: string;
	platform: string;
	/** The Web Push endpoint URL, the Expo push token, or the desktop app's Device id. */
	endpoint: string;
	/** The Web Push subscription keys (`p256dh`, `auth`). Null for the other kinds. */
	keys: Record<string, string> | null;
	/** The session that registered it, or null. */
	sessionId: string | null;
	createdAt: number;
	lastSeenAt: number | null;
};

/** A push target as its Person sees it in Settings: no endpoint, no keys. */
export type PushTargetView = {
	id: string;
	kind: PushKind;
	name: string;
	platform: string;
	createdAt: number;
	lastSeenAt: number | null;
};

/** What a screen sends to register itself. */
export const registerTargetSchema = z.object({
	kind: pushKindSchema,
	name: z.string().trim().min(1).max(120),
	platform: z.string().trim().max(60).default(""),
	endpoint: z.string().trim().min(1).max(2048),
	keys: z.record(z.string(), z.string().max(512)).nullable().default(null),
});
export type RegisterTarget = z.input<typeof registerTargetSchema>;

export type TargetStore = ReturnType<typeof createTargetStore>;

export function createTargetStore(db: Database, now: () => number = Date.now) {
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
			createdAt: row.createdAt.getTime(),
			lastSeenAt: row.lastSeenAt?.getTime() ?? null,
		};
	}

	return {
		/** The Person's push targets, oldest first. */
		async of(personId: string): Promise<PushTarget[]> {
			const rows = await db
				.select()
				.from(pushTarget)
				.where(eq(pushTarget.personId, personId))
				.orderBy(pushTarget.createdAt);
			return rows.map(toTarget);
		},

		/** These push targets, by id. An id without a row is left out. */
		async byIds(ids: readonly string[]): Promise<PushTarget[]> {
			if (ids.length === 0) return [];
			const rows = await db
				.select()
				.from(pushTarget)
				.where(inArray(pushTarget.id, [...ids]));
			return rows.map(toTarget);
		},

		/**
		 * Registers a screen for the Person, or, when the Person has its
		 * endpoint already, gives it the new name and keys and marks it seen.
		 */
		async register(
			personId: string,
			input: RegisterTarget,
			sessionId: string | null = null,
		): Promise<PushTarget> {
			const parsed = registerTargetSchema.parse(input);
			const at = new Date(now());
			const [row] = await db
				.insert(pushTarget)
				.values({
					id: randomUUID(),
					personId,
					kind: parsed.kind,
					name: parsed.name,
					platform: parsed.platform,
					endpoint: parsed.endpoint,
					keys: parsed.keys ? JSON.stringify(parsed.keys) : null,
					sessionId,
					createdAt: at,
					lastSeenAt: at,
				})
				.onConflictDoUpdate({
					target: [pushTarget.personId, pushTarget.endpoint],
					set: {
						kind: parsed.kind,
						name: parsed.name,
						platform: parsed.platform,
						keys: parsed.keys ? JSON.stringify(parsed.keys) : null,
						sessionId,
						lastSeenAt: at,
					},
				})
				.returning();
			if (!row)
				throw new Error(
					"Night Shift could not turn on notifications here. Try again.",
				);
			return toTarget(row);
		},

		/**
		 * Removes one of the Person's push targets. Returns it, or null when
		 * the Person has no target of that id.
		 */
		async remove(personId: string, id: string): Promise<PushTarget | null> {
			const [row] = await db
				.delete(pushTarget)
				.where(and(eq(pushTarget.id, id), eq(pushTarget.personId, personId)))
				.returning();
			return row ? toTarget(row) : null;
		},

		/** Forgets a target its push service no longer knows. */
		async forget(id: string): Promise<void> {
			await db.delete(pushTarget).where(eq(pushTarget.id, id));
		},
	};
}

/** A push target as its Person sees it. */
export function targetView(target: PushTarget): PushTargetView {
	return {
		id: target.id,
		kind: target.kind,
		name: target.name,
		platform: target.platform,
		createdAt: target.createdAt,
		lastSeenAt: target.lastSeenAt,
	};
}
