import type { LandedFact } from "@nightshift/engine";
import { needsALookKey, parseGateKey } from "../../contract";
import { changedRuns, endedRuns, factsBySpace } from "../domain/facts";
import type { GateTracker } from "../domain/gate-tracker";
import type { StartedWait, WaitTracker } from "../domain/wait-tracker";
import { deviceWaitWords, needsALookWords } from "../domain/words";
import type { CloseNotice } from "./close-notice";
import type { Audience, InApp, RunEvents } from "./ports";
import type { TellPeople } from "./tell-people";

export type TellLandedFactsPorts = {
	gates: Pick<GateTracker, "apply">;
	waits: Pick<WaitTracker, "apply">;
	events: Pick<RunEvents, "run" | "severeTurn">;
	audience: Audience;
	inApp: Pick<InApp, "runChanged">;
	now(): number;
	/** `tellPeople`, bound by the wire. */
	tell(notice: TellPeople): Promise<void>;
	/** `closeNotice`, bound by the wire. */
	close(notice: CloseNotice): Promise<void>;
};

/**
 * Tells of the run events of one landing, Space by Space: the Gates that
 * closed, then the ones that opened, the device waits that ended and
 * started, the runs that ended, the flows a run's end turned severe, and
 * last the open screens of each run that changed otherwise.
 */
export const tellLandedFacts =
	(ports: TellLandedFactsPorts) =>
	async (facts: readonly LandedFact[]): Promise<void> => {
		for (const [spaceId, list] of factsBySpace(facts)) {
			/** The runs of this landing an item already tells of: a screen reads them again. */
			const told = new Set<string>();
			const { opened, closed } = await ports.gates.apply(spaceId, list);
			for (const key of closed) {
				await ports.close({ spaceId, key });
				const gate = parseGateKey(key);
				if (gate) told.add(gate.runId);
			}
			for (const { key, runId, stepId, urgency } of opened) {
				await ports.tell({
					kind: "gate-opened",
					key,
					ids: { spaceId, runId, stepId },
					urgency,
				});
				told.add(runId);
			}
			// The other Members' screens hear of the wait as a run that changed.
			const { started, ended } = ports.waits.apply(spaceId, list, ports.now());
			for (const key of ended) await ports.close({ spaceId, key });
			for (const wait of started) await tellWait(ports, spaceId, wait);
			for (const end of endedRuns(list)) {
				await ports.tell({
					kind: end.kind,
					key: end.key,
					ids: { spaceId, runId: end.runId, stepId: null },
				});
				told.add(end.runId);
			}
			for (const fact of list) {
				if (fact.kind === "run-ended")
					await tellSevere(ports, spaceId, fact.runId);
			}
			await runsChanged(ports, spaceId, list, told);
		}
	};

/**
 * A step waits for an offline Device: the Person the run runs for hears
 * of it, if they are still a Member of the Space. Nobody else does.
 */
async function tellWait(
	ports: TellLandedFactsPorts,
	spaceId: string,
	wait: StartedWait,
): Promise<void> {
	const run = await ports.events.run(spaceId, wait.runId);
	const personId = run?.personId;
	if (!run || !personId) return;
	if (!(await ports.audience.of(spaceId)).includes(personId)) return;
	await ports.tell({
		kind: "device-wait",
		key: wait.key,
		ids: { spaceId, runId: wait.runId, stepId: wait.stepId },
		people: [personId],
		words: (settings) =>
			deviceWaitWords({
				flow: run.title,
				device: wait.deviceName,
				stopAt: run.stopAt,
				timeZone: settings.timeZone,
				now: ports.now(),
			}),
	});
}

/**
 * A run's end turned its flow severe under Needs a look: every Member
 * of the Space hears "<flow>", "Needs a look. Failed 2 runs in a row."
 * A push only, of the Now urgency.
 */
async function tellSevere(
	ports: TellLandedFactsPorts,
	spaceId: string,
	runId: string,
): Promise<void> {
	const turn = await ports.events.severeTurn?.(spaceId, runId);
	if (!turn) return;
	const run = await ports.events.run(spaceId, runId);
	await ports.tell({
		kind: "flow-needs-a-look",
		key: needsALookKey(turn),
		ids: { spaceId, runId, stepId: null },
		inApp: false,
		urgency: "now",
		words: () =>
			needsALookWords({ flow: run?.title ?? turn.flow, signal: turn.signal }),
	});
}

/**
 * Tells the open screens of the Space's audience, once per run, that
 * what a list of runs shows of it changed. A Gate has an item of its
 * own. A spend so far, or what only the run's page shows, does not count.
 */
async function runsChanged(
	ports: TellLandedFactsPorts,
	spaceId: string,
	facts: readonly LandedFact[],
	told: ReadonlySet<string>,
): Promise<void> {
	const runs = changedRuns(facts, told);
	if (runs.size === 0) return;
	const audience = await ports.audience.of(spaceId);
	for (const runId of runs) {
		for (const personId of audience) {
			ports.inApp.runChanged({ kind: "in-app", personId }, { spaceId, runId });
		}
	}
}
