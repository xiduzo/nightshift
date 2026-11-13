import {
	type GateChoice,
	type RunSummary,
	runNow,
	waitedText,
} from "@nightshift/client";

import { retryLabel } from "./retry";

/** What you can do with a run that stopped: continue it, or leave it. */
export type StoppedOption = GateChoice & {
	/** What the bar's button does: "Retry run". */
	act: string;
	do: "retry" | "leave";
};

/** The option that leaves a run: it goes off Needs you. */
const LEAVE_IT = "Leave it";

/**
 * The options of a run that stopped, as cards in their color: Retry (a
 * run that failed) or Resume (one that stopped) in green, when the run
 * allows it, then Leave it in gray.
 */
export function stoppedOptions(run: RunSummary): StoppedOption[] {
	const label = retryLabel(run.status);
	const go: StoppedOption = {
		name: label,
		color: "green",
		impact:
			label === "Retry"
				? "The run continues at the step that failed."
				: "The run continues at the step where it stopped.",
		act: `${label} run`,
		do: "retry",
	};
	const leave: StoppedOption = {
		name: LEAVE_IT,
		color: "gray",
		impact: "It goes off this list. It stays in Runs.",
		act: "Leave run",
		do: "leave",
	};
	return runNow(run).allows.resume ? [go, leave] : [leave];
}

/**
 * Where the run is from and when it stopped: "Research · Daily digest ·
 * Failed at 01:22 · Ran for 14 min". A part that is not known stays out.
 */
export function stoppedFacts(
	run: Pick<RunSummary, "flowName" | "createdAt" | "endedAt">,
	{
		projectName,
		statusLabel,
		time,
	}: {
		projectName: string | null;
		/** The word of the run's status: "Failed". */
		statusLabel: string;
		time: (epochMs: number) => string;
	},
): string {
	const end = run.endedAt ?? run.createdAt;
	return [
		projectName,
		run.flowName,
		`${statusLabel} at ${time(end)}`,
		run.endedAt === null ? null : `Ran for ${waitedText(end - run.createdAt)}`,
	]
		.filter(Boolean)
		.join(" · ");
}
