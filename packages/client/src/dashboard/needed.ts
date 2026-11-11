import type { NightsRange } from "./types";

/**
 * Why a run needed you, in words: a person answered a Gate or an Ask,
 * resumed, stopped, or took the run over. Both apps say it the same way.
 */

/** Why a run needed you. */
export type NeededYouReason = NonNullable<
	NightsRange["needed"]
>["reasons"][number]["reason"];

/** What you did, as a list names it. */
const LABEL: Record<NeededYouReason, string> = {
	gate: "Answered a Gate",
	ask: "Answered an Ask",
	resumed: "Resumed",
	stopped: "Stopped",
	"took-over": "Took over",
};

/** What you did to a run, as a list names it. */
export function neededReasonLabel(reason: NeededYouReason): string {
	return LABEL[reason];
}

/** Why runs needed you, in one line: "Answered a Gate: 3 runs. Resumed: 1 run." Empty without a reason. */
export function neededReasonsText(
	reasons: readonly { reason: NeededYouReason; runs: number }[],
): string {
	return reasons
		.map(
			({ reason, runs }) =>
				`${LABEL[reason]}: ${runs} ${runs === 1 ? "run" : "runs"}.`,
		)
		.join(" ");
}
