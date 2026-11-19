import { type Actor, commandOf, permissionOf } from "../../../contract";
import type { rerunNodeRefusal } from "../../../graph";
import type { parseRunFlow } from "../../../read";
import { RunRefusal, refuseUnless } from "../../../run-status";
import type { Access } from "../../access";
import type { RunFacts, StartHolds, Turns, Walkers } from "../../walk";

export type RerunFromNodePorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state">;
	turns: Pick<Turns, "take">;
	walkers: Pick<Walkers, "send">;
	/** A run again makes the run active: refused while its Space's Projects move. */
	holds: Pick<StartHolds, "start">;
	/** The run's flow, from its snapshot (`read/`). */
	flowOf: typeof parseRunFlow;
	/** Why a run cannot walk again from a node of its flow, or null (`graph/`). */
	rerunNodeRefusal: typeof rerunNodeRefusal;
};

/** Which run, in which Space when the caller holds one, and where it walks again from. */
export type RerunFromNode = {
	runId: string;
	spaceId?: string;
	/** A node of the run's own flow. */
	nodeId: string;
	/** The step of that node whose Agent session continues. Absent: its latest. */
	stepId?: string;
	prompt?: string;
	/** An Agent node starts a new session with its own prompt. */
	fresh?: boolean;
};

/**
 * Walks a run that is not going again from a node of its own flow, with
 * a new visit of it. The actor's role must allow `run.resume` in the run's
 * Space. Only the Walker runs it again: a run another Device walks is
 * refused (`walked-elsewhere`). A node the flow does not have is refused
 * before the run's Turn. Refused while the Space's Projects move.
 */
export const rerunFromNode =
	(ports: RerunFromNodePorts) =>
	async (actor: Actor, request: RerunFromNode): Promise<void> => {
		const { facts, turns } = ports;
		const { runId: _, spaceId, ...rerun } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("rerun"),
		});
		if (!walkedHere) {
			const runState = await facts.state(run.id);
			// Only the Walker runs it again: the status rule says so.
			refuseUnless(
				"rerun",
				runState.status,
				false,
				runState.end?.result ?? null,
			);
			const command = commandOf({ kind: "rerun", ...rerun });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		// Before the slot: a node the flow does not have is refused first.
		const refusal = ports.rerunNodeRefusal(ports.flowOf(run), rerun.nodeId);
		if (refusal) throw new RunRefusal("unknown-node", refusal);
		await ports.holds.start(run.spaceId, () =>
			turns.take(
				run.id,
				{ kind: "rerun", by: "person", ...rerun },
				{
					check: (runState) => refuseUnless("rerun", runState.status, true),
				},
			),
		);
	};
