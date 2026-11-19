import type { Database } from "@nightshift/db";
import { memberRole, type SpaceDocuments } from "./documents";
import type { RunLog } from "./log";
import { wireAccess } from "./runs";

/**
 * The access block of the engine's composition (`wire.ts`): who may see
 * or act on a run, or act in a Space (`runs/access/`). Lane R1 of the
 * hexagon series owns this file.
 *
 * It gives `access.openRun` and `access.openSpace`, and `access.runs`: the
 * run use cases of `Engine.runs` this block holds (`open`).
 */
export function wireEngineAccess(deps: {
	db: Database;
	log: RunLog;
	documents: Pick<SpaceDocuments, "open">;
}) {
	const access = wireAccess({
		log: deps.log,
		members: {
			db: deps.db,
			// The Walker reads a Command's Person from the Space document's Members.
			documentRole: async (spaceId, personId) =>
				memberRole(await deps.documents.open(spaceId), personId),
		},
	});
	return { ...access, runs: { open: access.openRun } };
}
