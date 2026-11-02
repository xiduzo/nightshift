import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@nightshift/db";
import { usageInstall, usageOutbox, usageSent } from "@nightshift/db/schema";
import { asc, desc, eq, inArray, lt } from "drizzle-orm";

import { minuteOf } from "./anonymize";
import { parseUsageEvent } from "./parse";

/** Events older than this, by their minute, are dropped. */
export const USAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Waiting events past this count are dropped, oldest first. */
export const USAGE_MAX_EVENTS = 5_000;

export type UsageIdentity = {
	installId: string;
	hmacKey: string;
	activeOn: string | null;
};

function parsed(event: unknown): Record<string, unknown> | null {
	if (event === null || typeof event !== "object") return null;
	try {
		return parseUsageEvent(event as { name: string }) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}
}

function readJson(body: string): unknown {
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
}

/** The install row, or null before the first stored event and before a reset. */
export async function readIdentity(
	db: Database,
): Promise<UsageIdentity | null> {
	const [row] = await db
		.select()
		.from(usageInstall)
		.where(eq(usageInstall.id, 1));
	if (!row) return null;
	return {
		installId: row.installId,
		hmacKey: row.hmacKey,
		activeOn: row.activeOn,
	};
}

/**
 * Inserts the identity if this computer has none yet. A row that is already
 * there stays, so two events at once share one key.
 */
export async function insertIdentity(
	db: Database,
	identity: { installId: string; hmacKey: string },
): Promise<void> {
	await db
		.insert(usageInstall)
		.values({ id: 1, installId: identity.installId, hmacKey: identity.hmacKey })
		.onConflictDoNothing();
}

/** A new install id and a new key. Hashes from now on do not match the old ones. */
export async function replaceIdentity(db: Database): Promise<UsageIdentity> {
	const identity = {
		installId: randomUUID(),
		hmacKey: randomBytes(32).toString("hex"),
	};
	await db
		.insert(usageInstall)
		.values({ id: 1, ...identity, activeOn: null })
		.onConflictDoUpdate({
			target: usageInstall.id,
			set: {
				installId: identity.installId,
				hmacKey: identity.hmacKey,
				activeOn: null,
			},
		});
	return { ...identity, activeOn: null };
}

/** The UTC day of the daily event, once it is stored. */
export async function markActiveDay(db: Database, day: string): Promise<void> {
	await db
		.update(usageInstall)
		.set({ activeOn: day })
		.where(eq(usageInstall.id, 1));
}

/**
 * Stores one anonymous event, then drops what is past seven days or past
 * 5,000 events. An event that does not parse is refused.
 */
export async function keepEvent(
	db: Database,
	event: unknown,
	at: number,
	now: number,
): Promise<boolean> {
	const body = parsed(event);
	if (!body) return false;
	await db.insert(usageOutbox).values({
		at: minuteOf(at),
		body: JSON.stringify(body),
	});
	await trimEvents(db, now);
	return true;
}

async function trimEvents(db: Database, now: number): Promise<void> {
	await db
		.delete(usageOutbox)
		.where(lt(usageOutbox.at, now - USAGE_MAX_AGE_MS));
	const ids = await db
		.select({ id: usageOutbox.id })
		.from(usageOutbox)
		.orderBy(desc(usageOutbox.id));
	const keep = ids[USAGE_MAX_EVENTS - 1]?.id;
	if (ids.length > USAGE_MAX_EVENTS && keep !== undefined) {
		await db.delete(usageOutbox).where(lt(usageOutbox.id, keep));
	}
}

export type WaitingEvent = {
	id: number;
	at: number;
	event: Record<string, unknown>;
};

/** The anonymous events still on this computer, oldest first. */
export async function waitingEvents(db: Database): Promise<WaitingEvent[]> {
	const rows = await db.select().from(usageOutbox).orderBy(asc(usageOutbox.id));
	const events: WaitingEvent[] = [];
	for (const row of rows) {
		const event = parsed(readJson(row.body));
		if (event) events.push({ id: row.id, at: row.at, event });
	}
	return events;
}

/** The last batch that left, as that JSON. Empty when nothing has left. */
export async function lastSentEvents(db: Database): Promise<unknown[]> {
	const [row] = await db.select().from(usageSent).where(eq(usageSent.id, 1));
	if (!row) return [];
	const body = readJson(row.body);
	return Array.isArray(body) ? body : [];
}

/** Replaces the remembered batch with the one that just left. */
export async function rememberSent(
	db: Database,
	events: readonly Record<string, unknown>[],
	at: number,
): Promise<void> {
	const body = JSON.stringify(events);
	await db
		.insert(usageSent)
		.values({ id: 1, body, sentAt: at })
		.onConflictDoUpdate({
			target: usageSent.id,
			set: { body, sentAt: at },
		});
}

/** Drops the waiting rows a batch took with it. */
export async function removeEvents(
	db: Database,
	ids: readonly number[],
): Promise<void> {
	if (ids.length === 0) return;
	await db.delete(usageOutbox).where(inArray(usageOutbox.id, [...ids]));
}
