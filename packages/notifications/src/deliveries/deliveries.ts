import type { Database } from "@nightshift/db";
import { notificationDelivery } from "@nightshift/db/schema";
import { and, eq, inArray, lte } from "drizzle-orm";

/**
 * The delivery log: what the notifier did with each event for each
 * Person, keyed by (Person, event key). A key is claimed once, so a
 * notification goes out once, also after a restart or when the same event
 * lands twice. The log names the push targets that got it, so a withdraw
 * reaches each of them.
 */

/** What a notification tells. */
export type NoticeKind = "gate-opened" | "run-finished" | "run-failed";

/**
 * `held`: waits until `dueAt`, because another screen is open. `quiet`:
 * waits for the end of quiet hours. `sent`: went out. `dropped`: did not
 * go out and never will. `withdrawn`: the Gate closed after it went out.
 */
export type DeliveryStatus =
	| "held"
	| "quiet"
	| "sent"
	| "dropped"
	| "withdrawn";

export type Delivery = {
	personId: string;
	key: string;
	kind: NoticeKind;
	spaceId: string;
	runId: string;
	stepId: string | null;
	status: DeliveryStatus;
	dueAt: number | null;
	/** The push targets that got it, by id. */
	sentTo: string[];
	/** The push targets that still wait for it, by id. */
	heldFor: string[];
	createdAt: number;
	sentAt: number | null;
	withdrawnAt: number | null;
};

/** A new entry of the log. */
export type Claim = Pick<
	Delivery,
	"personId" | "key" | "kind" | "spaceId" | "runId" | "stepId"
>;

/** What can change on an entry. */
export type DeliveryChange = Partial<
	Pick<
		Delivery,
		"status" | "dueAt" | "sentTo" | "heldFor" | "sentAt" | "withdrawnAt"
	>
>;

/** The statuses of an entry that can still reach a screen, or did. */
const LIVE: DeliveryStatus[] = ["held", "quiet", "sent"];

export type DeliveryLog = ReturnType<typeof createDeliveryLog>;

export function createDeliveryLog(db: Database) {
	function toDelivery(row: typeof notificationDelivery.$inferSelect): Delivery {
		return {
			personId: row.personId,
			key: row.key,
			kind: row.kind as NoticeKind,
			spaceId: row.spaceId,
			runId: row.runId,
			stepId: row.stepId,
			status: row.status as DeliveryStatus,
			dueAt: row.dueAt?.getTime() ?? null,
			sentTo: ids(row.sentTo),
			heldFor: ids(row.heldFor),
			createdAt: row.createdAt.getTime(),
			sentAt: row.sentAt?.getTime() ?? null,
			withdrawnAt: row.withdrawnAt?.getTime() ?? null,
		};
	}

	const date = (ms: number | null | undefined) =>
		ms === undefined ? undefined : ms === null ? null : new Date(ms);

	function columns(change: DeliveryChange) {
		const set: Partial<typeof notificationDelivery.$inferInsert> = {};
		if (change.status !== undefined) set.status = change.status;
		if (change.dueAt !== undefined) set.dueAt = date(change.dueAt);
		if (change.sentTo !== undefined) set.sentTo = JSON.stringify(change.sentTo);
		if (change.heldFor !== undefined)
			set.heldFor = JSON.stringify(change.heldFor);
		if (change.sentAt !== undefined) set.sentAt = date(change.sentAt);
		if (change.withdrawnAt !== undefined)
			set.withdrawnAt = date(change.withdrawnAt);
		return set;
	}

	return {
		/**
		 * Claims the event for the Person: true the first time, false when
		 * the log has it already. A Gate that was withdrawn and opens again
		 * (its step asked again) is claimed anew.
		 */
		async claim(
			claim: Claim,
			change: DeliveryChange & { status: DeliveryStatus },
			now: number,
		): Promise<boolean> {
			const values = {
				...claim,
				...columns(change),
				status: change.status,
				createdAt: new Date(now),
			};
			const [added] = await db
				.insert(notificationDelivery)
				.values(values)
				.onConflictDoNothing()
				.returning({ key: notificationDelivery.key });
			if (added) return true;
			const [again] = await db
				.update(notificationDelivery)
				.set({
					...values,
					sentTo: values.sentTo ?? "[]",
					heldFor: values.heldFor ?? "[]",
					sentAt: values.sentAt ?? null,
					withdrawnAt: null,
				})
				.where(
					and(
						eq(notificationDelivery.personId, claim.personId),
						eq(notificationDelivery.key, claim.key),
						eq(notificationDelivery.status, "withdrawn"),
					),
				)
				.returning({ key: notificationDelivery.key });
			return again !== undefined;
		},

		/** Changes the Person's entry of the key. */
		async update(
			personId: string,
			key: string,
			change: DeliveryChange,
		): Promise<void> {
			const set = columns(change);
			if (Object.keys(set).length === 0) return;
			await db
				.update(notificationDelivery)
				.set(set)
				.where(
					and(
						eq(notificationDelivery.personId, personId),
						eq(notificationDelivery.key, key),
					),
				);
		},

		/** Every Person's entry of the key that can still reach a screen, or did. */
		async live(key: string): Promise<Delivery[]> {
			const rows = await db
				.select()
				.from(notificationDelivery)
				.where(
					and(
						eq(notificationDelivery.key, key),
						inArray(notificationDelivery.status, LIVE),
					),
				);
			return rows.map(toDelivery);
		},

		/** The held entries whose time has come. */
		async due(now: number): Promise<Delivery[]> {
			const rows = await db
				.select()
				.from(notificationDelivery)
				.where(
					and(
						eq(notificationDelivery.status, "held"),
						lte(notificationDelivery.dueAt, new Date(now)),
					),
				);
			return rows.map(toDelivery);
		},

		/** The entries that wait for the end of quiet hours. */
		async quiet(): Promise<Delivery[]> {
			const rows = await db
				.select()
				.from(notificationDelivery)
				.where(eq(notificationDelivery.status, "quiet"));
			return rows.map(toDelivery);
		},

		/** The Gates of the log that may still be open: held, quiet or sent. */
		async liveGates(): Promise<Delivery[]> {
			const rows = await db
				.select()
				.from(notificationDelivery)
				.where(
					and(
						eq(notificationDelivery.kind, "gate-opened"),
						inArray(notificationDelivery.status, LIVE),
					),
				);
			return rows.map(toDelivery);
		},
	};
}

function ids(text: string): string[] {
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
}
