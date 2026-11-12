import type { EarlyWake, RunState, StopFact } from "../log";
import { ladderOf } from "./ladder";
import { deriveSteps } from "./run-views";

/**
 * Needed you: what a person did to a run, from its log. The person leaves
 * the loop when a run needs nobody. The dashboard counts the runs that
 * needed you, Flow health shows why, and the export to monitoring marks
 * each run's end with it.
 *
 * Only what a person did counts:
 *
 * - `gate`: a person answered a Gate. An open Gate counts once answered.
 *   A deadline that chose for nobody does not count.
 * - `ask`: a person answered an Ask (a Gate with a form, ADR 10).
 * - `resumed`: a person resumed the run, restarted its step, ran it again
 *   from a node, or woke it early. The daemon's own resumes and wakes (a
 *   Device came back, a lease went) do not count, and neither does a
 *   signal.
 * - `stopped`: a person stopped the run, now or after its running step,
 *   and did not withdraw it. The stop of a restart is its resume, not a
 *   stop. A stop Night Shift made (an Offer ended) does not count.
 * - `took-over`: a person copied or shared the command that takes the run
 *   over by hand.
 *
 * A move to another Device does not count: the run did not need it.
 *
 * Planned or not (docs/research/dashboards-2026-11.md, Q12): an answer to
 * a Gate or an Ask that the flow draws for a person is `planned`. An
 * answer after a ladder ran out (another try of the same node came first)
 * is not, and neither is a resume, a stop or a take-over.
 *
 * Older logs: a stop without `by` was a person's, and a stop that a
 * restart's `RunResumed` follows was a restart. A wake without `by` was a
 * person's unless its step slept for an offline Device or a lease: only
 * Night Shift wakes those early.
 */

/** Why a run needed you. */
export const NEEDED_YOU_REASONS = [
	"gate",
	"ask",
	"resumed",
	"stopped",
	"took-over",
] as const;

export type NeededYouReason = (typeof NEEDED_YOU_REASONS)[number];

/** How much of a Gate's question a step-in keeps. */
const QUESTION_LENGTH = 120;

/** One time a person stepped in: why, and when. */
export type NeededYou = {
	reason: NeededYouReason;
	at: number;
	/**
	 * The flow draws this Gate or Ask for a person: an approval, not a
	 * fallback. False on every other step-in. Older Hosts send none.
	 */
	planned?: boolean;
	/** A Gate or an Ask: its node. Older Hosts send none. */
	nodeId?: string;
	/** A Gate or an Ask: the start of its question. Older Hosts send none. */
	question?: string;
};

/**
 * Whether a step-in was planned. An older Host does not say: its Gates
 * and Asks count as planned, so an old run raises no alarm.
 */
export function isPlanned(act: NeededYou): boolean {
	return act.planned ?? (act.reason === "gate" || act.reason === "ask");
}

/** The sleeps only Night Shift ends early: it looks again when the Device or the lease is back. */
const DAEMON_WAKES: ReadonlySet<string> = new Set(["device-offline", "lease"]);

/** A wake a person asked for. A signal woke it otherwise, or Night Shift did. */
function personWake(wake: EarlyWake): boolean {
	if (wake.payload.signal !== undefined) return false;
	if (wake.payload.by !== undefined) return wake.payload.by === "person";
	return wake.reason === null || !DAEMON_WAKES.has(wake.reason);
}

/** A stop a person made that was not the stop of a restart. */
function personStop(stop: StopFact, run: RunState): boolean {
	if (stop.by === "daemon" || stop.restart) return false;
	if (stop.afterStep) return true;
	// An older log: the restart's resume follows its stop.
	const next = run.resumes.find((resume) => resume.seq > stop.seq);
	return next?.payload.action !== "restart";
}

/** Each time a person stepped in on the run, oldest first. Empty: it needed nobody. */
export function neededYouOf(run: RunState): NeededYou[] {
	const acts: NeededYou[] = [];
	const { fallbacks } = ladderOf(deriveSteps(run));
	for (const step of run.steps.values()) {
		for (const wait of step.gateWaits) {
			if (wait.answeredBy !== "person") continue;
			acts.push({
				reason: wait.ask ? "ask" : "gate",
				at: wait.answeredAt ?? wait.to ?? wait.from,
				planned: !fallbacks.has(step.id),
				nodeId: step.nodeId,
				question: wait.question.slice(0, QUESTION_LENGTH),
			});
		}
	}
	const unplanned = (reason: NeededYouReason, at: number): NeededYou => ({
		reason,
		at,
		planned: false,
	});
	for (const resume of run.resumes) {
		if ((resume.payload.by ?? "person") === "person") {
			acts.push(unplanned("resumed", resume.at));
		}
	}
	for (const wake of run.earlyWakes) {
		if (personWake(wake)) acts.push(unplanned("resumed", wake.at));
	}
	for (const stop of run.stops) {
		if (personStop(stop, run)) acts.push(unplanned("stopped", stop.at));
	}
	for (const taken of run.takeOvers) {
		acts.push(unplanned("took-over", taken.at));
	}
	return acts.sort((a, b) => a.at - b.at);
}
