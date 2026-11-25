import type { SharedAnswerCosts } from "@nightshift/engine";
import {
	ANSWER_COSTS_MAX,
	answerCostsBatchSchema,
	type HostClient,
	hostAnswer,
} from "../contract";
import { pause } from "../links";

/**
 * This Device's half of the exchange of answer costs with one Host: what
 * the answers of Night Shift's own agents cost, for the Spaces that Host
 * keeps. The Host's half is `HostExchange.answerCosts`.
 *
 * Run it as a stream of the link (`Link.stream`). Each turn gives the Host
 * this computer's own rows it lacks and takes the rows after this
 * computer's cursors, until both are in step. Then it waits `idleMs` and
 * looks again: an answer's cost reaches the Host, and the Space's other
 * computers, within that time. A row is one answer by its key, so a turn
 * that fails halfway goes again, whole.
 *
 * The Host offline: the rows wait here, and go when the link is back.
 */
export function shareAnswerCosts(deps: {
	/** The Spaces this Host keeps for this computer (`HostSpaces.ofHost`). */
	spaces(): Promise<string[]>;
	/** This Replica's answer costs (`Engine.answerCosts`). */
	costs: Pick<SharedAnswerCosts, "unsent" | "sent" | "cursors" | "ingest">;
	now(): number;
	/** How long it waits before it looks again. Default 30 s. */
	idleMs?: number;
}) {
	const { costs } = deps;
	return async (client: HostClient, signal: AbortSignal) => {
		while (!signal.aborted) {
			const spaces = await deps.spaces();
			let more = spaces.length > 0;
			while (more && !signal.aborted) {
				const rows = await costs.unsent(spaces, ANSWER_COSTS_MAX);
				const answer = hostAnswer(
					answerCostsBatchSchema,
					await client.sync.answerCosts(
						{ rows, cursors: await costs.cursors(spaces) },
						{ signal },
					),
				);
				const now = deps.now();
				await costs.ingest(answer.rows, now);
				await costs.sent(answer.taken, now);
				// A row the Host left out (a Space the person left) waits: it does
				// not turn this into a loop.
				more =
					answer.more ||
					(rows.length === ANSWER_COSTS_MAX && answer.taken.length > 0);
			}
			await pause(deps.idleMs ?? 30_000, signal);
		}
	};
}
