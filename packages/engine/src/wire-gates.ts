import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { ArtifactStore } from "./artifacts";
import { wireGates } from "./gates";
import type { Views, Walk } from "./runs";

/**
 * The gates block of the engine's composition (`wire.ts`): the questions
 * that wait for a person (`gates/`). Lane R6 of the hexagon series owns
 * this file.
 *
 * It gives `answer`: the actions block takes the answer to a Gate from it.
 * `forSpace`: the Space view's lists of the open and the answered Gates.
 * And `cases`: the use cases of `Engine.gates` (the answer and the inbox).
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
	// Each use case opens the run, or the Space, for its actor and checks
	// the actor's role itself.
	const cases = wireGates({
		access: deps.access,
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
	});

	return {
		answer: cases.answerGate,
		forSpace: {
			listOpenGates: cases.listOpenGates,
			listAnsweredGates: cases.listAnsweredGates,
		},
		cases: {
			answer: cases.answerGate,
			inbox: cases.listInbox,
			answeredInbox: cases.listAnsweredInbox,
		},
	};
}
