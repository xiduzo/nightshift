import type { Database } from "@nightshift/db";
import type { ArtifactStore } from "./artifacts";
import { NIGHT_SHIFT } from "./contract";
import { wireGates } from "./gates";
import type { Access, Views, Walk } from "./runs";

/**
 * The gates block of the engine's composition (`wire.ts`): the questions
 * that wait for a person (`gates/`). Lane R6 of the hexagon series owns
 * this file.
 *
 * It gives `answerWith`: the actions block takes the answer to a Gate from
 * it, over each way it opens a run. `forSpace`: the Space view's lists of
 * the open and the answered Gates. And `cases`: the use cases of
 * `Engine.gates` (the answer and the inbox). Each binding is the same use
 * cases. Only the way they open a run or a Space differs: the Space view
 * reads no role yet (see below).
 */
export function wireEngineGates(deps: {
	db: Database;
	access: Pick<Access, "openRun" | "openSpace">;
	walk: Pick<Walk, "facts" | "turns" | "walkers">;
	/** Where the Walker keeps the files of an answer. */
	artifacts: Pick<ArtifactStore, "saveAnswer">;
	/** The views of the runs: the open and the answered Gates of a Space. */
	views: { reads: Pick<Views["reads"], "listGates" | "listAnsweredGates"> };
	now(): number;
}) {
	const { reads } = deps.views;
	/**
	 * The Gates over one way to open a run or a Space. Only the API's door
	 * (`Engine.gates`) applies the lock-screen rule, as before: the Space
	 * view's `act` takes Commands from the Host and the Walker too.
	 */
	const bind = (
		access: Pick<Access, "openRun" | "openSpace">,
		checksLockScreen = false,
	) =>
		wireGates({
			access,
			walk: deps.walk,
			members: { db: deps.db },
			gates: {
				open: (spaceId) => reads.listGates(spaceId),
				answered: (spaceId, since) => reads.listAnsweredGates(spaceId, since),
			},
			files: {
				save: async (answer) => {
					await deps.artifacts.saveAnswer(answer);
				},
			},
			now: deps.now,
			checksLockScreen,
		});
	// `Engine.gates`: each use case checks the actor's role itself.
	const cases = bind(deps.access, true);
	// The Space view: each door checks the Person's role before it calls the
	// view (the API, the Host, the Walker, the notifier as Night Shift).
	// Until lane R8 moves that check into the use cases, the view opens the
	// run, or the Space, as before: no role is read. So no door answers
	// differently.
	const view = bind({
		openRun: (_actor, { runId, spaceId }) =>
			deps.access.openRun(NIGHT_SHIFT, { runId, spaceId }),
		openSpace: async () => {},
	});

	return {
		answerWith: (openRun: Access["openRun"]) =>
			bind({ openRun, openSpace: deps.access.openSpace }).answerGate,
		forSpace: {
			listOpenGates: view.listOpenGates,
			listAnsweredGates: view.listAnsweredGates,
		},
		cases: {
			answer: cases.answerGate,
			inbox: cases.listInbox,
			answeredInbox: cases.listAnsweredInbox,
		},
	};
}
