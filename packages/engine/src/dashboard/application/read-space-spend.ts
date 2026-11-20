import type { Actor } from "../../contract";
import {
	lastDays,
	NIGHT_RANGES,
	type SpaceSpend,
	summarizeSpend,
} from "../measures";
import type { AnswerCosts, DashboardRuns } from "./ports";

/** The days of help cost the Spend page reads: its longest range. A month is shorter. */
const HELP_DAYS = Math.max(...NIGHT_RANGES);

export type ReadSpaceSpendPorts = {
	runs: Pick<DashboardRuns, "list">;
	answerCosts: AnswerCosts;
};

/** The Spend page of a Space: what its runs cost, where a change saves, and what Night Shift's own agents cost. */
export const readSpaceSpend =
	(ports: ReadSpaceSpendPorts) =>
	async (
		actor: Actor,
		request: { spaceId: string; now: number; timeZone: string },
	): Promise<SpaceSpend> => {
		const { spaceId, now, timeZone } = request;
		// The longest range and this month both start within these days.
		const since = lastDays(HELP_DAYS, now, timeZone)[0];
		const [runs, help] = await Promise.all([
			ports.runs.list(actor, { spaceId }),
			ports.answerCosts.list(actor, { spaceId, since }),
		]);
		return summarizeSpend(runs, { now, timeZone, help });
	};
