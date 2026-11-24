import { flowSchema } from "../../../schema";
import { migrateFlow } from "./chain";

/**
 * How a run snapshot read at 2026-11-24 (f4ae25afa), before the rewrite of
 * old data: a copy of the chain, the recipes it writes and the reader. It
 * is frozen. Do not change it with the chain: it is what the rewrite is
 * compared with. Only `flowSchema` is not a copy.
 */
export function readBefore(json: unknown): unknown {
	const migrated = migrateFlow(json);
	const parsed = flowSchema.safeParse(migrated);
	return parsed.success ? parsed.data : migrated;
}
