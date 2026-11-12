import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import {
	type Actor,
	HostUnreachableError,
	type Relay,
	type RunCommandInput,
	type StartRunInput,
} from "../contract";
import { hasRunRow, type RunLog, type RunRow } from "../log";
import type { RunSummary } from "../read";
import { RunRefusal } from "../run-status";

/** How long a Device waits for a run its Host started to arrive. */
const RUN_ARRIVES_MS = 30_000;

/** Why a test run does not start in a Space a Host keeps, for now. */
export const TEST_RUN_ON_HOST =
	"A test run cannot start yet in a Space that another computer keeps. Start the run without pins and skips.";

/**
 * Runs another Device walks. The Walker is the only writer of its run's
 * events, so an action on such a run travels to it as a command through
 * the Host (`Relay.command`), and the Walker applies it. A run placed on
 * another Device starts on the Host that keeps the Space.
 */
export function createRunRelay(deps: {
	db: Database;
	log: Pick<RunLog, "events">;
	relay?: Relay;
	now(): number;
	/** The runs of a project in the Space, as the run list shows them. */
	listRuns(spaceId: string, projectId?: string): Promise<RunSummary[]>;
}) {
	const { db, log, relay } = deps;

	return {
		/** Hands an action on a run walked elsewhere to its Walker, in the actor's name. */
		async send(
			row: RunRow,
			actor: Actor | undefined,
			command: RunCommandInput,
		): Promise<void> {
			if (!relay) {
				throw new RunRefusal(
					"walker-unreachable",
					"Another device runs this run, and this computer cannot reach it.",
				);
			}
			if (!actor) {
				throw new RunRefusal("signed-out", "Sign in to act on this run.");
			}
			await relay.command({
				...command,
				spaceId: row.spaceId,
				runId: row.id,
				walkerId: row.walkerId,
				personId: actor.personId,
			});
		},

		/**
		 * Has the Host of the Space start a run placed on another Device: the
		 * Host walks it. Returns once the run's rows reached this Replica.
		 */
		async startOnHost(
			input: StartRunInput,
			spaceId: string,
		): Promise<RunSummary> {
			// The Host's start drops pins and skips, and would run every node
			// for real. A test run starts there once it takes them (ADR 27).
			if (input.test !== undefined) {
				throw new Refusal("unavailable", TEST_RUN_ON_HOST);
			}
			if (!relay) throw new HostUnreachableError();
			const { runId } = await relay.startRun({ ...input, spaceId });
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

export type RunRelay = ReturnType<typeof createRunRelay>;
