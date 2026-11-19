import { type Actor, permissionOf, personOf } from "../../../contract";
import type { lastHarnessSession } from "../../../read";
import { RunRefusal, WALKED_ELSEWHERE } from "../../../run-status";
import type { Access } from "../../access";
import type { RunFacts, Turns } from "../../walk";
import { takenOverBefore } from "../domain/action-rules";

export type RecordTakeOverPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "append">;
	turns: Pick<Turns, "hold">;
	/** The run's latest session with a harness session, and its step (`read/`). */
	lastHarnessSession: typeof lastHarnessSession;
};

/** Which run, in which Space when the caller holds one. */
export type RecordTakeOver = { runId: string; spaceId?: string };

/**
 * A person took the run over by hand: they copied or shared the command
 * that opens its last harness session. The actor's role must allow
 * `run.resume` in the run's Space. Only the Walker logs it: a run another
 * Device walks is refused (`walked-elsewhere`). Logs `RunTakenOver` on the
 * step of the run's last harness session, in a Turn that drives nothing.
 * Once per step and person in a walk: a second copy adds nothing. A run
 * with no harness session has nothing to take over.
 */
export const recordTakeOver =
	(ports: RecordTakeOverPorts) =>
	async (actor: Actor, request: RecordTakeOver): Promise<void> => {
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId: request.spaceId,
			need: permissionOf("take-over"),
		});
		// Only the Walker logs it: a screen offers it only there.
		if (!walkedHere) throw new RunRefusal("walked-elsewhere", WALKED_ELSEWHERE);
		const by = personOf(actor);
		await ports.turns.hold(run.id, async ({ runState }) => {
			const last = ports.lastHarnessSession(runState);
			if (!last?.stepId) return;
			if (takenOverBefore(runState, last.stepId, by)) return;
			await ports.facts.append({
				type: "RunTakenOver",
				runId: run.id,
				stepId: last.stepId,
				payload: { by, harness: last.harness },
			});
		});
	};
