import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema";
import { instant } from "@nightshift/time";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { EngineEventType, EventInput, LoggedEvent } from "../events";

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
 * Appends one event as `walkerId`'s next and returns its row as committed,
 * with its seq, its time and its Space. The Walker's count (`walker_seq`) is taken in the same
 * statement, so two appends cannot get one number. The event's Space is
 * its run's, or for a fact of no run its project's (`payload.projectId`),
 * read in the same statement too. `writes` commit in one batch with the
 * event: a row and the event that names it land together or not at all.
 * The engine appends through its run log (`run-log.ts`), never here
 * directly.
 */
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
	const payload = JSON.parse(row.payload);
	// A scope with no parent step is no scope: the step is at the top level.
	if (payload?.scope && typeof payload.scope.parentStepId !== "string") {
		payload.scope = null;
	}
	return {
		seq: row.seq,
		runId: row.runId,
		stepId: row.stepId,
		sessionId: row.sessionId,
		type: row.type,
		payload,
		at: instant(row.at),
	} as LoggedEvent;
}
