import { sharedAnswerCosts } from "@nightshift/engine";
import { ANSWER_COSTS_MAX } from "../contract";
import type { HostExchangeDeps } from "./host-deps";
import type { HostExchange } from "./types";

/**
 * What the answers of Night Shift's own agents cost, as a Device sends
 * and takes them (`sync.answerCosts`), for the Spaces this Host keeps.
 */
export function hostAnswerCosts(
	deps: Pick<HostExchangeDeps, "db" | "engine" | "selfId">,
): Pick<HostExchange, "answerCosts"> {
	const { engine } = deps;
	const answerCosts = sharedAnswerCosts(deps.db);
	return {
		async answerCosts(caller, input) {
			// Only the Spaces of the Person that this Host keeps: another
			// Host's Space has its own costs.
			const spaces: string[] = [];
			for (const spaceId of await caller.spaces()) {
				if ((await engine.hostSpaces.hostOf(spaceId)) === null) {
					spaces.push(spaceId);
				}
			}
			const taken = await answerCosts.take(
				input.rows.filter((row) => spaces.includes(row.spaceId)),
				{ deviceId: caller.deviceId, personId: caller.personId },
			);
			// One more than a call carries says whether more wait.
			const rows = await answerCosts.after({
				spaces,
				cursors: input.cursors,
				selfId: deps.selfId,
				limit: ANSWER_COSTS_MAX + 1,
			});
			return {
				taken,
				rows: rows.slice(0, ANSWER_COSTS_MAX),
				more: rows.length > ANSWER_COSTS_MAX,
			};
		},
	};
}
