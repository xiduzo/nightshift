import type { Database } from "@nightshift/db";
import type { ArtifactStore } from "./artifacts";
import { NIGHT_SHIFT } from "./contract";
import type { RunWalks } from "./graph";
import type { RunsPort } from "./peers";
import type { PlacementPort } from "./placement";
import { createAnswerPath, createMovePath } from "./run";
import { type Access, type Walk, wireActions } from "./runs";
import type { UsageNotes } from "./usage";

/**
 * The actions block of the engine's composition (`wire.ts`): what a person
 * does to a run (`runs/actions/`), with the answer to a Gate
 * (`run/answer.ts`) and the move of a run (`run/move.ts`) until lanes R6
 * and R5 make them use cases. Lane R4 of the hexagon series owns this
 * file.
 *
 * It gives `actions`: the Space view reads `actions.act` and
 * `actions.moveTargets`. And `runs`: the run use cases of `Engine.runs`
 * this block holds. Both are the same use cases. Only the way they open a
 * run differs: the Space view reads no role yet (see below).
 */
export function wireEngineActions(deps: {
	access: Pick<Access, "openRun">;
	walk: Pick<Walk, "facts" | "turns" | "walkers" | "holds">;
	db: Database;
	/** Where the Walker keeps the files of an answer. */
	artifacts: Pick<ArtifactStore, "saveAnswer">;
	/** The archive a moved run's walk state goes to (`RunsPort.keepWalk`). */
	archive: Pick<RunsPort, "keepWalk">;
	walks: Pick<RunWalks, "exportWalk">;
	/** This computer as a Device. */
	device: { id: string };
	placement: Pick<PlacementPort, "moveTo" | "devicesFor" | "deviceById">;
	/** Lets go of a run's leases (`LeaseKeeper.release`). */
	leases: Parameters<typeof wireActions>[0]["leases"];
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
}) {
	/** The actions, with the answer and the move, over one way to open a run. */
	function bind(openRun: Access["openRun"]) {
		const answer = createAnswerPath({
			openRun,
			walk: deps.walk,
			artifacts: deps.artifacts,
		});
		const move = createMovePath({
			openRun,
			walk: deps.walk,
			db: deps.db,
			archive: deps.archive,
			walks: deps.walks,
			device: deps.device,
			placement: deps.placement,
		});
		const acts = wireActions({
			access: { openRun },
			walk: deps.walk,
			leases: deps.leases,
			...(deps.usage ? { usage: deps.usage } : {}),
			answer,
			move: move.move,
		});
		return { acts, move };
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
		actions: {
			act: view.acts.actOnRun,
			moveTargets: view.move.moveTargets,
		},
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
