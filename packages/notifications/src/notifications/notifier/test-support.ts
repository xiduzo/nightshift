import { notificationDelivery } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import type { LandedFact } from "@nightshift/engine";
import { INBOX_KEEP_MS } from "@nightshift/engine";
import type { GateUrgency } from "@nightshift/flows";
import { instant, instantOrNull } from "@nightshift/time";
import { sql } from "drizzle-orm";
import { drizzleDeliveryLog } from "./adapters/out/drizzle-delivery-log";
import {
	inMemoryAudience,
	inMemoryInApp,
	inMemoryMayAnswer,
	inMemoryPersonSettings,
	inMemoryPushes,
	inMemoryPushTargets,
	inMemoryRunEvents,
	inMemorySendsFor,
	inMemorySpaceList,
} from "./adapters/out/in-memory-neighbours";
import { catchUpNotices } from "./application/catch-up-notices";
import { closeNotice } from "./application/close-notice";
import { endDeviceWaits } from "./application/end-device-waits";
import { endQuietHours } from "./application/end-quiet-hours";
import { pruneDeliveries } from "./application/prune-deliveries";
import { runChecks } from "./application/run-checks";
import { sendHeldPushes } from "./application/send-held-pushes";
import { tellLandedFacts } from "./application/tell-landed-facts";
import { tellMissedSchedule } from "./application/tell-missed-schedule";
import { tellPeople } from "./application/tell-people";
import { tellRunChanged } from "./application/tell-run-changed";
import type { OpenGateRef } from "./domain/gate-tracker";
import { createGateTracker } from "./domain/gate-tracker";
import { createBundles, createPruneClock } from "./domain/notifier-state";
import { createWaitTracker } from "./domain/wait-tracker";

/**
 * The notifier's use cases bound to their ports, as the wire binds them,
 * and the run events a use-case test lands. The delivery log is the real
 * one, over a database in memory. The test calls a use case where the
 * notifier's queue would, and reads the ports.
 */

/** The delivery log, and the entries it holds, so a test can read one whole. */
async function deliveries() {
	const db = await migratedDb();
	const rows = async () =>
		(await db.select().from(notificationDelivery).orderBy(sql`rowid`)).map(
			(row) => ({
				...row,
				sentTo: JSON.parse(row.sentTo) as string[],
				heldFor: JSON.parse(row.heldFor) as string[],
				dueAt: instantOrNull(row.dueAt),
				createdAt: instant(row.createdAt),
				sentAt: instantOrNull(row.sentAt),
				withdrawnAt: instantOrNull(row.withdrawnAt),
			}),
		);
	return {
		...drizzleDeliveryLog(db),
		/** Every entry, in the order of its first claim. */
		rows,
		/** The Person's entry of the key, or undefined. */
		entry: async (personId: string, key: string) =>
			(await rows()).find((r) => r.personId === personId && r.key === key),
	};
}

/**
 * Every port of the notifier in memory at once, and the state its use
 * cases share: where each use-case test starts. Two Spaces: `space-1`
 * with ada and bob, `space-2` with cy. This daemon sends for both. ada may
 * answer the Gates of `space-1`, cy those of `space-2`.
 */
async function notifierPorts() {
	const members: Record<string, string[]> = {
		"space-1": ["ada", "bob"],
		"space-2": ["cy"],
	};
	const events = inMemoryRunEvents();
	const sendsFor = inMemorySendsFor();
	sendsFor.senders.add("space-1").add("space-2");
	const mayAnswer = inMemoryMayAnswer();
	mayAnswer.answerers.add("space-1:ada").add("space-2:cy");
	const ports = {
		/** The time of the test, in ms. A test sets it. */
		time: 0,
		now: (): number => ports.time,
		members,
		events,
		audience: inMemoryAudience(members),
		spaces: inMemorySpaceList(members),
		mayAnswer,
		sendsFor,
		settings: inMemoryPersonSettings(),
		targets: inMemoryPushTargets(),
		inApp: inMemoryInApp(),
		pushes: inMemoryPushes(),
		deliveries: await deliveries(),
		// Reads the events of `ports`, so an override of them counts.
		gates: createGateTracker(
			(spaceId: string): Promise<OpenGateRef[]> =>
				ports.events.openGates(spaceId),
		),
		waits: createWaitTracker(),
		bundles: createBundles(),
		pruning: createPruneClock(),
		inboxKeepMs: INBOX_KEEP_MS,
		/** What went wrong, in order. */
		errors: [] as string[],
		onError: (message: string): void => {
			ports.errors.push(message);
		},
	};
	return ports;
}

/** The twins of one notifier, and the state its use cases share. */
type NotifierPorts = Awaited<ReturnType<typeof notifierPorts>>;

/** What a landed fact says beyond its run: by default it changes what a list of runs shows. */
type What<F = LandedFact> = F extends unknown
	? Omit<F, "spaceId" | "runId" | "seq" | "changes"> & {
			changes?: LandedFact["changes"];
		}
	: never;

/**
 * `overrides`: ports another notifier of the test uses too, so two
 * notifiers share one log.
 */
export async function notifier(overrides: Partial<NotifierPorts> = {}) {
	const ports = Object.assign(await notifierPorts(), overrides);
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
