import { NIGHT_SHIFT } from "./contract";
import { type Access, type Move, type Walk, wireActions } from "./runs";
import type { UsageNotes } from "./usage";

/**
 * The actions block of the engine's composition (`wire.ts`): what a person
 * does to a run (`runs/actions/`), with the answer to a Gate (`gates/`,
 * from `wire-gates.ts`) and the move of a run (`runs/move/`, from
 * `wire-move.ts`). Lane R4 of the hexagon series owns this file.
 *
 * It gives `actions`: the Space view reads `actions.act`. And `runs`: the
 * run use cases of `Engine.runs` this block holds. Both are the same use
 * cases. Only the way they open a run differs: the Space view reads no
 * role yet (see below).
 */
export function wireEngineActions(deps: {
	access: Pick<Access, "openRun">;
	walk: Pick<Walk, "facts" | "turns" | "walkers" | "holds">;
	/** The answer to a Gate (`answerGate` of `gates/`), over a way to open a run. */
	answer(
		openRun: Access["openRun"],
	): Parameters<typeof wireActions>[0]["answer"];
	/** The move of a run (`runs/move/`), over a way to open a run. */
	moveRunWith(openRun: Access["openRun"]): Move["moveRun"];
	/** Lets go of a run's leases (`LeaseKeeper.release`). */
	leases: Parameters<typeof wireActions>[0]["leases"];
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
}) {
	/** The actions, with the answer and the move, over one way to open a run. */
	function bind(openRun: Access["openRun"]) {
		const acts = wireActions({
			access: { openRun },
			walk: deps.walk,
			leases: deps.leases,
			...(deps.usage ? { usage: deps.usage } : {}),
			answer: deps.answer(openRun),
			move: deps.moveRunWith(openRun),
		});
		return { acts };
	}

	// The Space view: each door checks the Person's role before it calls
	// `act` (the API, the Host, the Walker). Until lane R8 moves that check
	// into the use cases, the view opens the run as before: in its Space,
	// with no role read. So no door answers differently.
	const view = bind((_actor, { runId, spaceId }) =>
		deps.access.openRun(NIGHT_SHIFT, { runId, spaceId }),
	);
	// `Engine.runs`: each use case checks the actor's role itself.
	const { acts } = bind(deps.access.openRun);

	return {
		actions: { act: view.acts.actOnRun },
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
