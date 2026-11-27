/**
 * How long the cleanup keeps the work that was only on this computer
 * (`workToKeep`), and whether a run still has it. Pure: the facts come
 * from the run's end and from the `WorktreeRemoved` facts of this computer.
 *
 * The work goes `KEPT_WORK_DAYS` after the run ended, and never sooner
 * than `KEPT_WORK_DAYS` after the cleanup last kept it: a run that ended
 * long ago while this computer was off keeps its work hidden that long
 * too. A run this computer does not know has no end here: its work goes
 * `KEPT_WORK_DAYS` after the cleanup last kept it. Without either fact,
 * the work stays. An open run
 * keeps it, as does a run only another version can continue (`keepsWork`).
 */

const DAY_MS = 24 * 60 * 60_000;

/** How many days after a run ended the cleanup frees the work it kept of it. */
export const KEPT_WORK_DAYS = 30;

/** What the cleanup knows of one run's kept work. */
export type KeptWorkFacts = {
	/** When the run ended (or started, when it has no end). Null for a run this computer does not know. */
	endedAt: number | null;
	/** When the cleanup last kept work of the run (`WorktreeRemoved` with `kept`, or this sweep). Null when it never did. */
	keptAt: number | null;
	/** Nothing removes the run's work: it goes on, or only another version can continue it. */
	open: boolean;
	now: number;
};

/** Whether the cleanup frees the run's kept work now, or keeps it. */
export function keptWorkFate(facts: KeptWorkFacts): "free" | "keep" {
	if (facts.open) return "keep";
	const { endedAt, keptAt } = facts;
	const since =
		endedAt !== null && keptAt !== null
			? Math.max(endedAt, keptAt)
			: (endedAt ?? keptAt);
	if (since === null) return "keep";
	return since + KEPT_WORK_DAYS * DAY_MS <= facts.now ? "free" : "keep";
}

/** One `WorktreeRemoved` of a run, as far as its kept work goes. */
export type KeptWorkRemoval = {
	kept: boolean;
	expired: boolean;
	/** It removed a copy of the run here (`worktreePath`). */
	copy: boolean;
};

/**
 * Whether the work the cleanup kept of a run is gone: of the run's
 * removals, oldest first, the last that kept work, freed it or removed a
 * copy freed it. A copy removed after the work went was made again from
 * somewhere else (the run's branch, origin): the run has its work again.
 */
export function keptWorkGone(removals: readonly KeptWorkRemoval[]): boolean {
	const last = removals.findLast(
		(removal) => removal.kept || removal.expired || removal.copy,
	);
	return last?.expired ?? false;
}

/** What the person reads when a run cannot continue because its kept work is gone. */
export const KEPT_WORK_GONE = `The work of this run is gone. Night Shift keeps it for ${KEPT_WORK_DAYS} days after the run ends. Start a new run to do the work again.`;
