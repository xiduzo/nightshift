import type { Access } from "../../access";
import type { Actor } from "../../contract";
import { type AnswerCost, knownAnswerCosts } from "../domain/answer-costs";
import type { AnswerCostStore } from "./ports";

export type ListAnswerCostsPorts = {
	access: Pick<Access, "openSpace">;
	answerCostStore: Pick<AnswerCostStore, "list">;
};

/** Which Space, and since when (ms): only the answers that ended at or after it. */
export type ListAnswerCosts = { spaceId: string; since?: number };

/**
 * What the answers of a Space cost, the oldest first, as this Replica has
 * them. An answer of an agent this version does not know is left out.
 * Who asks: the Spend page of the Space. A Member of the Space may,
 * whatever the role (`access.openSpace`).
 */
export const listAnswerCosts =
	(ports: ListAnswerCostsPorts) =>
	async (actor: Actor, request: ListAnswerCosts): Promise<AnswerCost[]> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		return knownAnswerCosts(
			await ports.answerCostStore.list(request.spaceId, request.since),
		);
	};
