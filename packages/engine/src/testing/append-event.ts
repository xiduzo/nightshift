import type { Database } from "@nightshift/db";
import type { EngineEventType, EventInput, LoggedEvent } from "../log/events";
import {
	appendEventRow,
	type EventWrites,
	parseEventRow,
} from "../log/run-log/append";

/** Appends one event as `walkerId`'s next, past the run log, and reads it back. */
export async function appendEvent<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	walkerId: string,
	writes: EventWrites = {},
): Promise<LoggedEvent> {
	return parseEventRow(await appendEventRow(db, input, walkerId, writes));
}
