import type { InsightsDb } from "../client";
import { usageEvent } from "../schema";
import { readLogs } from "./payload";
import type { IngestResult } from "./rules";

/**
 * Parses an OTLP/HTTP JSON logs body and inserts the events the registry
 * accepts. `country` is the caller's CF-IPCountry header. The request body
 * is not logged.
 */
export async function ingestLogs(
	db: InsightsDb,
	body: unknown,
	options: { country: string | null },
): Promise<IngestResult> {
	const read = readLogs(body, options);
	if (read.rows.length > 0) await db.insert(usageEvent).values(read.rows);
	return {
		accepted: read.rows.length,
		refused: read.refused,
		refusals: read.refusals,
	};
}
