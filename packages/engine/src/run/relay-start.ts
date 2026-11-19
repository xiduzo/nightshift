import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import {
	HostUnreachableError,
	type Relay,
	type StartRunInput,
} from "../contract";
import { hasRunRow, type RunLog } from "../log";
import type { RunSummary } from "../read";
import { resolveTestRun } from "./test-run";

/** How long a Device waits for a run its Host started to arrive. */
const RUN_ARRIVES_MS = 30_000;

/**
 * A run placed on another Device starts on the Host that keeps the Space.
 * An action on a run another Device walks travels the same way
 * (`relay-commands.ts`).
 */
export function createStartRelay(deps: {
	db: Database;
	log: Pick<RunLog, "events" | "row" | "state">;
	relay?: Relay;
	now(): number;
	/** The runs of a project in the Space, as the run list shows them. */
	listRuns(spaceId: string, projectId?: string): Promise<RunSummary[]>;
}) {
	const { db, log, relay } = deps;

	return {
		/**
		 * Has the Host of the Space start a run placed on another Device: the
		 * Host walks it. Returns once the run's rows reached this Replica.
		 *
		 * A test run's pins travel as refs (ADR 27): the Host reads their
		 * outputs from its own log. This computer reads them from its own log
		 * first, so a pin it cannot use is refused in the words of a run it
		 * walks itself, and the Host refuses only a run that has not reached
		 * it yet. A start that pins and skips nothing is no test run.
		 */
		async startOnHost(
			input: StartRunInput,
			spaceId: string,
		): Promise<RunSummary> {
			if (!relay) throw new HostUnreachableError();
			const test = await resolveTestRun(
				input.test,
				{ id: input.projectId, spaceId },
				log,
			);
			const start =
				test === null && input.test !== undefined
					? { ...input, test: undefined }
					: input;
			const { runId } = await relay.startRun({ ...start, spaceId });
			const deadline = deps.now() + RUN_ARRIVES_MS;
			while (deps.now() < deadline) {
				if (
					(await hasRunRow(db, runId)) &&
					(await log.events(runId)).length > 0
				) {
					const [summary] = (
						await deps.listRuns(spaceId, input.projectId)
					).filter((r) => r.id === runId);
					if (summary) return summary;
				}
				await Bun.sleep(200);
			}
			throw new Refusal(
				"unavailable",
				"The run started. It shows in the run list in a moment.",
			);
		},
	};
}

export type StartRelay = ReturnType<typeof createStartRelay>;
