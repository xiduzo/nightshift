import { OlderHostError, type sharedAnswerCosts } from "@nightshift/engine";
import { ANSWER_COSTS_MAX, type HostClient } from "../contract";
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
 * The Host offline: the rows wait here, and go when the link is back. A
 * Host of an older version has no such call (`OlderHostError`): the rows
 * wait, and this computer asks again in an hour.
 */
export function shareAnswerCosts(deps: {
	/** The Spaces this Host keeps for this computer (`HostSpaces.ofHost`). */
	spaces(): Promise<string[]>;
	/** This Replica's answer costs (`sharedAnswerCosts`). */
	costs: Pick<
		ReturnType<typeof sharedAnswerCosts>,
		"unsent" | "sent" | "cursors" | "ingest"
	>;
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
				let answer: Awaited<ReturnType<HostClient["sync"]["answerCosts"]>>;
				try {
					answer = await client.sync.answerCosts(
						{ rows, cursors: await costs.cursors(spaces) },
						{ signal },
					);
				} catch (error) {
					if (!(error instanceof OlderHostError)) throw error;
					await pause(OLDER_HOST_WAIT_MS, signal);
					return;
				}
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

/** How long it waits before it asks a Host of an older version again. */
const OLDER_HOST_WAIT_MS = 60 * 60_000;
