import type { LandedFact } from "@nightshift/engine";
import type { GateUrgency } from "@nightshift/flows";
import { catchUpNotices } from "../../application/catch-up-notices";
import { closeNotice } from "../../application/close-notice";
import { endDeviceWaits } from "../../application/end-device-waits";
import { endQuietHours } from "../../application/end-quiet-hours";
import { pruneDeliveries } from "../../application/prune-deliveries";
import { runChecks } from "../../application/run-checks";
import { sendHeldPushes } from "../../application/send-held-pushes";
import { tellLandedFacts } from "../../application/tell-landed-facts";
import { tellMissedSchedule } from "../../application/tell-missed-schedule";
import { tellPeople } from "../../application/tell-people";
import { tellRunChanged } from "../../application/tell-run-changed";
import type { OpenGateRef } from "../../domain/gate-tracker";
import {
	inMemoryNotifierPorts,
	type NotifierTwins,
} from "./in-memory-neighbours";

/**
 * The notifier's use cases bound to `inMemoryNotifierPorts`, as the wire
 * binds them, and the run events a use-case test lands. The test calls a
 * use case where the notifier's queue would, and reads the twins. Test
 * code: production code never imports this file.
 */

/** What a landed fact says beyond its run: by default it changes what a list of runs shows. */
type What<F = LandedFact> = F extends unknown
	? Omit<F, "spaceId" | "runId" | "seq" | "changes"> & {
			changes?: LandedFact["changes"];
		}
	: never;

/**
 * `overrides`: twins another notifier of the test uses too, so two
 * notifiers share one log.
 */
export function inMemoryNotifier(overrides: Partial<NotifierTwins> = {}) {
	const ports = Object.assign(inMemoryNotifierPorts(), overrides);
	const tell = tellPeople(ports);
	const close = closeNotice(ports);
	const endWaits = endDeviceWaits({ ...ports, close });
	const sendHeld = sendHeldPushes(ports);
	const endQuiet = endQuietHours(ports);
	const prune = pruneDeliveries(ports);
	const tellLanded = tellLandedFacts({ ...ports, tell, close });
	let seq = 0;

	/** A run event that landed, as the engine's landed feed tells it. */
	function landed(runId: string, what: What, spaceId = "space-1"): LandedFact {
		seq += 1;
		return { spaceId, runId, seq, changes: "summary", ...what } as LandedFact;
	}

	return {
		ports,
		tell,
		close,
		catchUp: catchUpNotices({ ...ports, tell, close }),
		tellLanded,
		tellMissed: tellMissedSchedule({ ...ports, tell }),
		runChanged: tellRunChanged({ ...ports, close }),
		endWaits,
		sendHeld,
		endQuiet,
		prune,
		checks: runChecks({ now: ports.now, endWaits, sendHeld, endQuiet, prune }),
		landed,
		/** The seq of the last fact that landed. */
		seq: () => seq,
		/**
		 * A Gate opens: the engine reads it open from now on, and its event
		 * lands. `urgency`: `now` by default. Null: the fact names none.
		 */
		async openGate(
			runId: string,
			stepId: string,
			spaceId = "space-1",
			{
				urgency = "now",
				...facts
			}: Omit<OpenGateRef, "runId" | "stepId"> & {
				urgency?: GateUrgency | null;
			} = {},
		) {
			ports.events.setOpen(spaceId, [
				...(await ports.events.openGates(spaceId)),
				{ runId, stepId, ...facts },
			]);
			await tellLanded([
				landed(
					runId,
					{ kind: "gate-opened", stepId, ...(urgency ? { urgency } : {}) },
					spaceId,
				),
			]);
		},
		/** A Gate is answered: the engine no longer reads it open, and its step ends. */
		async answerGate(runId: string, stepId: string, spaceId = "space-1") {
			ports.events.setOpen(
				spaceId,
				(await ports.events.openGates(spaceId)).filter(
					(g) => !(g.runId === runId && g.stepId === stepId),
				),
			);
			await tellLanded([
				landed(runId, { kind: "step-ended", stepId }, spaceId),
			]);
		},
		/** A run ends. */
		async endRun(
			runId: string,
			status: Extract<LandedFact, { kind: "run-ended" }>["status"],
		) {
			await tellLanded([landed(runId, { kind: "run-ended", status })]);
		},
	};
}
