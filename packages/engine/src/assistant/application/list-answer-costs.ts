import type { Actor } from "../../contract";
import { type AnswerCost, knownAnswerCosts } from "../domain/answer-costs";
import type { AnswerCostStore } from "./ports";

export type ListAnswerCostsPorts = {
	answerCostStore: Pick<AnswerCostStore, "list">;
};

/** Which Space, and since when (ms): only the answers that ended at or after it. */
export type ListAnswerCosts = { spaceId: string; since?: number };

/**
 * What the answers of a Space cost, the oldest first, as this Replica has
 * them. An answer of an agent this version does not know is left out.
 * Who asks: the Spend page of the Space. It checks no role, as before:
 * the door checks that the Person is in the Space.
 */
export const listAnswerCosts =
	(ports: ListAnswerCostsPorts) =>
	async (_actor: Actor, request: ListAnswerCosts): Promise<AnswerCost[]> =>
		knownAnswerCosts(
			await ports.answerCostStore.list(request.spaceId, request.since),
		);
