import type { LandedFact, ScheduleMissed } from "@nightshift/engine";
import { needsALookKey, parseGateKey, scheduleMissedKey } from "../contract";
import type { Delivery } from "../deliveries";
import { changedRuns, endedRuns, factsBySpace } from "./domain/facts";
import type { StartedWait } from "./domain/wait-tracker";
import {
	deviceWaitWords,
	needsALookWords,
	scheduleMissedWords,
} from "./domain/words";
import type { NotifierParts } from "./parts";
import { close, tell } from "./telling";

/** What the notifier does when run events land, a schedule is missed, and it starts. */

/**
 * A step waits for an offline Device: the Person the run runs for hears
 * of it, if they are still a Member of the Space. Nobody else does.
 */
async function tellWait(
	parts: NotifierParts,
	spaceId: string,
	wait: StartedWait,
): Promise<void> {
	const { deps, now } = parts;
	const run = await deps.events.run(spaceId, wait.runId);
	const personId = run?.personId;
	if (!run || !personId) return;
	if (!(await deps.audience(spaceId)).includes(personId)) return;
	await tell(
		parts,
		"device-wait",
		wait.key,
		{ spaceId, runId: wait.runId, stepId: wait.stepId },
		{
			people: [personId],
			words: (settings) =>
				deviceWaitWords({
					flow: run.title,
					device: wait.deviceName,
					stopAt: run.stopAt,
					timeZone: settings.timeZone,
					now: now(),
				}),
		},
	);
}

/**
 * A schedule's cron time was missed by more than it allows: every
 * Member of the Space hears "A schedule did not start", with the flow
 * and the time on their own clock. A push only: no open page has an
 * item for it, so it goes when the person closes their pages.
 */
export async function tellMissed(
	parts: NotifierParts,
	missed: ScheduleMissed,
): Promise<void> {
	const { now } = parts;
	await tell(
		parts,
		"schedule-missed",
		scheduleMissedKey(missed),
		{ spaceId: missed.spaceId, runId: "", stepId: null },
		{
			inApp: false,
			words: (settings) =>
				scheduleMissedWords({
					flow: missed.flow,
					at: missed.at,
					timeZone: settings.timeZone,
					now: now(),
				}),
		},
	);
}

/**
 * A run's end turned its flow severe under Needs a look: every Member
 * of the Space hears "<flow>", "Needs a look. Failed 2 runs in a row."
 * A push only, of the Now urgency.
 */
async function tellSevere(
	parts: NotifierParts,
	spaceId: string,
	runId: string,
): Promise<void> {
	const { deps } = parts;
	const turn = await deps.events.severeTurn?.(spaceId, runId);
	if (!turn) return;
	const run = await deps.events.run(spaceId, runId);
	await tell(
		parts,
		"flow-needs-a-look",
		needsALookKey(turn),
		{ spaceId, runId, stepId: null },
		{
			inApp: false,
			urgency: "now",
			words: () =>
				needsALookWords({
					flow: run?.title ?? turn.flow,
					signal: turn.signal,
				}),
		},
	);
}

export async function handle(
	parts: NotifierParts,
	facts: readonly LandedFact[],
): Promise<void> {
	const { gates, waits, now } = parts;
	for (const [spaceId, list] of factsBySpace(facts)) {
		/** The runs of this landing an item already tells of: a screen reads them again. */
		const told = new Set<string>();
		const { opened, closed } = await gates.apply(spaceId, list);
		for (const key of closed) {
			await close(parts, spaceId, key);
			const gate = parseGateKey(key);
			if (gate) told.add(gate.runId);
		}
		for (const { key, runId, stepId, urgency } of opened) {
			await tell(
				parts,
				"gate-opened",
				key,
				{ spaceId, runId, stepId },
				{ urgency },
			);
			told.add(runId);
		}
		// The other Members' screens hear of the wait as a run that changed.
		const { started, ended } = waits.apply(spaceId, list, now());
		for (const key of ended) await close(parts, spaceId, key);
		for (const wait of started) await tellWait(parts, spaceId, wait);
		for (const end of endedRuns(list)) {
			await tell(parts, end.kind, end.key, {
				spaceId,
				runId: end.runId,
				stepId: null,
			});
			told.add(end.runId);
		}
		for (const fact of list) {
			if (fact.kind === "run-ended")
				await tellSevere(parts, spaceId, fact.runId);
		}
		await runsChanged(parts, spaceId, list, told);
	}
}

/**
 * Tells the open screens of the Space's audience, once per run, that
 * what a list of runs shows of it changed. A Gate has an item of its
 * own. A spend so far, or what only the run's page shows, does not count.
 */
async function runsChanged(
	parts: NotifierParts,
	spaceId: string,
	facts: readonly LandedFact[],
	told: ReadonlySet<string>,
): Promise<void> {
	const { deps } = parts;
	const runs = changedRuns(facts, told);
	if (runs.size === 0) return;
	const audience = await deps.audience(spaceId);
	for (const runId of runs) {
		for (const personId of audience) {
			deps.inApp.runChanged({ kind: "in-app", personId }, { spaceId, runId });
		}
	}
}

export async function baseline(parts: NotifierParts): Promise<void> {
	const { deps, gates, waits } = parts;
	await gates.baseline(await deps.spaces());
	// Gates that closed while this daemon was away: withdraw them now.
	const closed = new Map<string, string>();
	for (const row of await deps.deliveries.liveOfKind("gate-opened")) {
		if (!gates.isOpen(row.spaceId, row.key)) closed.set(row.key, row.spaceId);
	}
	for (const [key, spaceId] of closed) await close(parts, spaceId, key);
	// Gates that opened while no notifier listened (a reload, a start, a
	// run that woke): pushed now. The log drops the ones already told.
	for (const { spaceId, key, runId, stepId } of gates.open()) {
		await tell(
			parts,
			"gate-opened",
			key,
			{ spaceId, runId, stepId },
			{ inApp: false },
		);
	}
	// Device waits the log told: over when their run no longer sleeps.
	const told = new Map<string, Delivery>();
	for (const row of await deps.deliveries.liveOfKind("device-wait")) {
		told.set(row.key, row);
	}
	for (const [key, row] of told) {
		const run = await deps.events.run(row.spaceId, row.runId);
		if (run?.sleeping) waits.track(row.spaceId, key);
		else await close(parts, row.spaceId, key);
	}
}

/** A command of the run changed: reads the run's Gates again, and closes the ones with an answer on its way. */
export async function recheck(
	parts: NotifierParts,
	spaceId: string,
	runId: string,
): Promise<void> {
	const { closed } = await parts.gates.recheck(spaceId, runId);
	for (const key of closed) await close(parts, spaceId, key);
}
