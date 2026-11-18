import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema";
import { instant } from "@nightshift/time";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
	type EngineEventType,
	type EventInput,
	type LoggedEvent,
	upgradePayload,
} from "../events";

/**
 * An event as a row of the log: how to append one, and how to read one
 * back. The payloads are in `events/`.
 */

/**
 * Statements that commit in one batch with the events they go with:
 * `before` the events (the rows they name), `after` them (what the log
 * says now: a run's Walker, a session's harness id).
 */
export type EventWrites = {
	before?: readonly BatchItem<"sqlite">[];
	after?: readonly BatchItem<"sqlite">[];
};

/**
 * Appends one event as `walkerId`'s next and returns it as committed, with
 * its seq and time. The Walker's count (`walker_seq`) is taken in the same
 * statement, so two appends cannot get one number. The event's Space is
 * its run's, or for a fact of no run its project's (`payload.projectId`),
 * read in the same statement too. `writes` commit in one batch with the
 * event: a row and the event that names it land together or not at all.
 * The engine appends through its run log (`run-log.ts`), never here
 * directly.
 */
export async function appendEvent<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	walkerId: string,
	writes: EventWrites = {},
): Promise<LoggedEvent> {
	return parseEventRow(await appendEventRow(db, input, walkerId, writes));
}

/** `appendEvent`, as the row it committed: with its Space and its Walker's count. */
export async function appendEventRow<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	walkerId: string,
	writes: EventWrites = {},
): Promise<typeof event.$inferSelect> {
	const insert = db
		.insert(event)
		.values({
			runId: input.runId ?? null,
			stepId: input.stepId ?? null,
			sessionId: input.sessionId ?? null,
			type: input.type,
			payload: JSON.stringify(input.payload),
			spaceId: spaceOf(input),
			walkerId,
			walkerSeq: sql`(select coalesce(max(${event.walkerSeq}), 0) + 1 from ${event} where ${event.walkerId} = ${walkerId})`,
		})
		.returning();
	const before = writes.before ?? [];
	const after = writes.after ?? [];
	const [row] =
		before.length === 0 && after.length === 0
			? await insert
			: ((
					await db.batch([...before, insert, ...after] as unknown as [
						BatchItem<"sqlite">,
						...BatchItem<"sqlite">[],
					])
				)[before.length] as (typeof event.$inferSelect)[]);
	if (!row) throw new Error(`Could not append ${input.type}.`);
	return row;
}

/** The Space of an event: its run's, else its project's, else the one it names. */
function spaceOf(input: EventInput<EngineEventType>) {
	if (input.runId) {
		return sql`(select ${run.spaceId} from ${run} where ${run.id} = ${input.runId})`;
	}
	if (input.spaceId) return input.spaceId;
	const projectId = (input.payload as { projectId?: unknown }).projectId;
	if (typeof projectId !== "string") {
		throw new Error(
			`${input.type} names no run, no project and no Space: its Space is unknown.`,
		);
	}
	return sql`(select ${project.spaceId} from ${project} where ${project.id} = ${projectId})`;
}

/**
 * An event as it landed in this Replica: with its Space, and its identity,
 * its Walker and its number among that Walker's events (`walker_seq`).
 */
export type LandedEvent = LoggedEvent & {
	spaceId: string;
	walkerId: string;
	walkerSeq: number;
};

/** The event of a committed row, as it landed. `logged`: the row, parsed. */
export function landedEvent(
	row: typeof event.$inferSelect,
	logged: LoggedEvent,
): LandedEvent {
	return {
		...logged,
		spaceId: row.spaceId,
		walkerId: row.walkerId,
		walkerSeq: row.walkerSeq,
	};
}

export function parseEventRow(row: typeof event.$inferSelect): LoggedEvent {
	const type = row.type as EngineEventType;
	return {
		seq: row.seq,
		runId: row.runId,
		stepId: row.stepId,
		sessionId: row.sessionId,
		type,
		payload: upgradePayload(type, JSON.parse(row.payload)),
		at: instant(row.at),
	} as LoggedEvent;
}
