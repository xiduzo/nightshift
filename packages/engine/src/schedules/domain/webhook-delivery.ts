import type { Schedule } from "@nightshift/flows";
import { scheduleKey } from "./schedule-history";

/**
 * Webhooks: a schedule with `webhook` starts its flow, sends its signal,
 * scores runs by their pull requests, or more than one, when a request
 * arrives at `/hooks/<project id>/<schedule id>`.
 *
 * The address is public on a Host, so the rules are strict:
 * - The sender proves it knows the schedule's secret (`webhook-proof.ts`).
 * - An unknown project or schedule, a schedule without a webhook, and a
 *   wrong or missing secret all answer the same `not-found`, after the
 *   same work: nobody learns whether a schedule exists.
 * - Nothing logs a secret or a body. The event (the body and the headers,
 *   without the ones that carry a secret) goes only to the run it starts,
 *   as its inputs, and to the Waits it wakes, as their data.
 * - A refused webhook is never logged: anyone may send one. The last few
 *   refusals of a schedule stay in memory (`createWebhookRefusals`), so
 *   the Schedules page can say why a webhook did nothing. An authenticated
 *   one is logged, accepted or filtered out.
 *
 * The same Device that fires a schedule's cron times takes its webhooks:
 * the Space's Host, else the one Device of a Space without a Host. The run
 * starts on that Device too (ADR 15): a schedule names no Device.
 */

/**
 * What the sender is told. `not-found`: no such schedule, or the secret did
 * not check out (one answer for both). `refused`: the secret checked out,
 * but the schedule does not take webhooks now (paused, or another Device
 * takes them).
 */
export type WebhookAnswer =
	| { kind: "accepted" }
	| { kind: "filtered" }
	| { kind: "refused"; reason: string }
	| { kind: "not-found" };

/** One webhook as the Schedules page lists it, newest first. */
export type WebhookDelivery = {
	/** When it arrived (epoch ms). */
	at: number;
	/**
	 * `accepted`: it started a run or sent its signal, or tried to.
	 * `filtered`: the schedule's rule did not hold. `refused`: the secret
	 * did not check out, or the schedule did not take it.
	 */
	result: "accepted" | "filtered" | "refused";
	/** Why it was refused, why the rule or the key failed, or why the run did not start. */
	reason: string | null;
	/** The run it started. */
	runId: string | null;
	/** How many runs its signal woke. */
	woke: number;
};

/** A webhook whose secret checked out, as the log keeps it. */
export type WebhookReceivedFact = {
	projectId: string;
	scheduleId: string;
	/** When it arrived (epoch ms). */
	at: number;
	result: "accepted" | "filtered";
	/** The run it started. */
	runId: string | null;
	/** How many runs its signal woke. */
	woke: number;
	/** Why the run did not start, or why the rule or the key failed. */
	error: string | null;
};

/** How many deliveries of a schedule the Schedules page shows. */
export const DELIVERIES_SHOWN = 10;

/**
 * The schedule of `scheduleId` when a webhook starts it, else null: no
 * such schedule, or one without a webhook. A duplicate id is an issue in
 * the UI: the first one counts.
 */
export function webhookScheduleOf(
	schedules: readonly Schedule[],
	scheduleId: string,
): Schedule | null {
	const schedule = schedules.find((one) => one.id === scheduleId);
	return schedule?.webhook ? schedule : null;
}

/** Why a webhook was refused before its secret checked out. The sender hears `not-found`. */
export const WEBHOOK_SECRET_WORDS = {
	/** The schedule's secret has no value on this computer. */
	noValue: (secretName: string | null) =>
		`The secret ${secretName ?? "of this schedule"} has no value here. Add it on the project's Secrets page.`,
	wrong: "The secret did not match.",
	none: "The request had no secret.",
} as const;

/**
 * Why a schedule does not take a webhook whose secret checked out, in the
 * order the reasons count, or null when it takes it. Each question is
 * asked only when the ones before it pass: `schedulesOn`, then
 * `firesHere`.
 */
export async function webhookRefusal(
	schedule: Schedule,
	schedulesOn: () => boolean,
	firesHere: () => Promise<boolean>,
): Promise<string | null> {
	if (!schedule.enabled) return "The schedule is paused.";
	if (!schedulesOn()) return "Schedules are paused.";
	if (!(await firesHere())) {
		return "The Host of this Space takes this webhook. Send it there.";
	}
	return null;
}

/** Why an accepted or filtered webhook did not do all its work. Stored in the log and shown. */
export const WEBHOOK_ERROR_WORDS = {
	rule: (error: string) => `The rule failed: ${error}`,
	signalKey: (error: string) => `The signal's key failed: ${error}`,
} as const;

/** The latest refusals of each schedule. In memory only: a refusal is never logged. */
export type WebhookRefusals = {
	add(projectId: string, scheduleId: string, at: number, reason: string): void;
	/** The refusals of a schedule, newest first, at most `DELIVERIES_SHOWN`. */
	of(projectId: string, scheduleId: string): WebhookDelivery[];
};

export function createWebhookRefusals(): WebhookRefusals {
	const refusals = new Map<string, WebhookDelivery[]>();
	return {
		add(projectId, scheduleId, at, reason) {
			const key = scheduleKey(projectId, scheduleId);
			const list = refusals.get(key) ?? [];
			list.unshift({ at, result: "refused", reason, runId: null, woke: 0 });
			refusals.set(key, list.slice(0, DELIVERIES_SHOWN));
		},
		of: (projectId, scheduleId) =>
			refusals.get(scheduleKey(projectId, scheduleId)) ?? [],
	};
}

/** A logged webhook as the Schedules page lists it. */
export function deliveryOf(fact: WebhookReceivedFact): WebhookDelivery {
	const { at, result, runId, woke, error } = fact;
	return { at, result, reason: error, runId, woke };
}

/** The latest webhooks of a schedule, newest first: logged ones and refusals. */
export function latestDeliveries(
	logged: readonly WebhookDelivery[],
	refused: readonly WebhookDelivery[],
): WebhookDelivery[] {
	return [...logged, ...refused]
		.sort((a, b) => b.at - a.at)
		.slice(0, DELIVERIES_SHOWN);
}
