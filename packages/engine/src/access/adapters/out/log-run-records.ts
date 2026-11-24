import { Refusal } from "@nightshift/refusal";
import type { RunLog } from "../../../log";
import type { RunRecords } from "../../application/ports";

/** The runs of this Replica over the run log: its row of each run, and whether this computer walks it. */
export function logRunRecords(
	log: Pick<RunLog, "row" | "walkedHere">,
): RunRecords {
	return {
		async find(runId) {
			try {
				return await log.row(runId);
			} catch (error) {
				// The log refuses a run it does not have: here that is no run.
				if (error instanceof Refusal && error.kind === "not-found") return null;
				throw error;
			}
		},
		walkedHere: (run) => log.walkedHere(run),
	};
}
