import { nodeLadderLabel } from "./ladders";
import type { SpendFlow, SpendSaving } from "./types";

/**
 * The Spend page in words both apps can share: how steady the cost of a
 * flow is, and what each way to save asks you to do, and why.
 */

/** How steady the cost of a flow's runs is. */
export type CostSteadiness = NonNullable<SpendFlow["steadiness"]>;

const STEADINESS: Record<CostSteadiness, { label: string; hint: string }> = {
	steady: {
		label: "Steady",
		hint: "Most runs cost within 20% of a usual run.",
	},
	varies: {
		label: "Varies",
		hint: "Some runs cost a lot more or less than a usual run.",
	},
	unsteady: {
		label: "Hard to predict",
		hint: "Many runs cost over twice a usual run, or one cost over four times that.",
	},
};

/** "Steady", "Varies" or "Hard to predict". */
export function steadinessLabel(steadiness: CostSteadiness): string {
	return STEADINESS[steadiness].label;
}

/** What the label says about the runs, in one sentence. */
export function steadinessHint(steadiness: CostSteadiness): string {
	return STEADINESS[steadiness].hint;
}

/** How many times a usual run the dearest run cost: "6×", "1.4×". */
export function timesUsual(usd: number, usual: number): string {
	if (usual <= 0) return "—";
	const times = usd / usual;
	return `${times >= 10 ? Math.round(times) : Math.round(times * 10) / 10}×`;
}

const SAVING_TITLE: Record<SpendSaving["kind"], string> = {
	unfinished: "Fix the runs that do not finish",
	nothing: "Check for work before the agents start",
	costly: "Keep the costly runs near a usual run",
};

/** What a way to save asks you to do. */
export function savingTitle(saving: Pick<SpendSaving, "kind">): string {
	return SAVING_TITLE[saving.kind];
}

/**
 * Why a way to save is one, from the runs: "3 of 30 runs did not finish."
 * `cost` formats the money.
 */
export function savingWhy(
	saving: SpendSaving,
	cost: (usd: number) => string,
): string {
	const { runs, of } = saving;
	const some = `${runs} of ${of} ${of === 1 ? "run" : "runs"}`;
	switch (saving.kind) {
		case "unfinished":
			return `${some} did not finish. They cost ${cost(saving.saves)}.`;
		case "nothing":
			return `${some} found nothing to do. They cost ${cost(saving.saves)}.`;
		default: {
			const step = saving.step
				? ` Most of the extra cost was in ${nodeLadderLabel(saving.step)}.`
				: "";
			return `${some} cost over twice a usual run.${step}`;
		}
	}
}

/** The way to save `value` names, or undefined when it names none. */
export function savingKindOf(value: string): SpendSaving["kind"] | undefined {
	return Object.hasOwn(SAVING_TITLE, value)
		? (value as SpendSaving["kind"])
		: undefined;
}
