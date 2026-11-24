import type { Access } from "./access";
import { type Move, type Walk, wireActions } from "./runs";
import type { UsageNotes } from "./usage";

/**
 * The actions block of the engine's composition (`wire.ts`): what a person
 * does to a run (`runs/actions/`), with the answer to a Gate (`gates/`,
 * from `wire-gates.ts`) and the move of a run (`runs/move/`, from
 * `wire-move.ts`). Lane R4 of the hexagon series owns this file.
 *
 * It gives `actions`: the Space view reads `actions.act`. And `runs`: the
 * run use cases of `Engine.runs` this block holds. Both are the same use
 * cases: each opens the run for its actor and checks the actor's role.
 */
export function wireEngineActions(deps: {
	access: Pick<Access, "openRun">;
	walk: Pick<Walk, "facts" | "turns" | "walkers" | "holds">;
	/** The answer to a Gate (`answerGate` of `gates/`). */
	answer: Parameters<typeof wireActions>[0]["answer"];
	/** The move of a run (`moveRun` of `runs/move/`). */
	move: Move["moveRun"];
	/** Lets go of a run's leases (`LeaseKeeper.release`). */
	leases: Parameters<typeof wireActions>[0]["leases"];
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
}) {
	const acts = wireActions({
		access: deps.access,
		walk: deps.walk,
		leases: deps.leases,
		...(deps.usage ? { usage: deps.usage } : {}),
		answer: deps.answer,
		move: deps.move,
	});

	return {
		actions: { act: acts.actOnRun },
		runs: {
			act: acts.actOnRun,
			stop: acts.stopRun,
			resume: acts.resumeRun,
			restartStep: acts.restartStep,
			rerun: acts.rerunFromNode,
			signal: acts.sendSignal,
			releaseLease: acts.releaseLease,
			markUseful: acts.markRunUseful,
			takeOver: acts.recordTakeOver,
		},
	};
}
