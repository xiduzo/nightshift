import {
	type FlowInputDef,
	type JsonValue,
	loadFlowSource,
	type Schedule,
	type WebhookEvent,
	webhookEvent,
	webhookHolds,
	webhookInputs,
	webhookSecretName,
	webhookSignalKey,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import { scheduledStart } from "../domain/scheduled-start";
import {
	WEBHOOK_ERROR_WORDS,
	WEBHOOK_SECRET_WORDS,
	type WebhookAnswer,
	type WebhookRefusals,
	webhookRefusal,
	webhookScheduleOf,
} from "../domain/webhook-delivery";
import { webhookAuthentic } from "../domain/webhook-proof";
import type {
	Clock,
	PullRequestScorer,
	ScheduledProjects,
	ScheduledRuns,
	ScheduleLog,
	ScheduleStore,
	ScheduleSwitch,
	WebhookSecrets,
} from "./ports";

export type ReceiveWebhookPorts = {
	clock: Clock;
	store: Pick<ScheduleStore, "list" | "flows">;
	secrets: WebhookSecrets;
	switch: ScheduleSwitch;
	projects: Pick<ScheduledProjects, "firesHere">;
	runs: Pick<ScheduledRuns, "signal" | "start">;
	scorer: PullRequestScorer;
	log: Pick<ScheduleLog, "received">;
	/** The refused webhooks this engine remembers: a refusal is never logged. */
	refusals: Pick<WebhookRefusals, "add">;
	/**
	 * A key that no secret is: what a request for an unknown schedule is
	 * checked against. A random value, made once when the engine is made.
	 */
	noSecret: string;
};

/** A webhook as the HTTP server hands it over. */
export type WebhookRequest = {
	projectId: string;
	scheduleId: string;
	headers: Headers;
	/** The raw body: the signature is over these bytes. */
	body: Uint8Array;
};

/**
 * Takes one webhook for a schedule: the answer for the sender, and
 * `done`, the work that goes on after it (the signal, the scores, the
 * run's start, the log). The address is public, so there is no actor:
 * the schedule's secret is the check. It never throws for a request:
 * `not-found` and `refused` are answers.
 *
 * The order is the rule (`domain/webhook-delivery.ts` has it in words).
 * The proof is computed for an unknown schedule too, so the answer takes
 * as long. The reasons a schedule does not take a webhook count in this
 * order: the schedule is off, schedules are off, another Device takes it.
 */
export const receiveWebhook =
	(ports: ReceiveWebhookPorts) =>
	async (
		request: WebhookRequest,
	): Promise<{ answer: WebhookAnswer; done: Promise<void> }> => {
		const { clock, store, secrets, projects, runs, scorer, log, refusals } =
			ports;

		/** The schedule, or null for any reason the sender may not learn. */
		async function find(
			projectId: string,
			scheduleId: string,
		): Promise<Schedule | null> {
			try {
				const { schedules } = await store.list(projectId, { validate: false });
				return webhookScheduleOf(schedules, scheduleId);
			} catch {
				return null;
			}
		}

		/** The inputs of the schedule's flow, to render its values with the right types. */
		async function flowInputs(
			projectId: string,
			flow: string,
		): Promise<readonly FlowInputDef[]> {
			try {
				const sources = await store.flows(projectId);
				return loadFlowSource(sources, flow).flow?.inputs ?? [];
			} catch {
				return [];
			}
		}

		/** What an accepted webhook does, after the sender has its answer. */
		async function act(
			projectId: string,
			schedule: Schedule,
			at: number,
			webhook: WebhookEvent,
		): Promise<void> {
			let runId: string | null = null;
			let woke = 0;
			const errors: string[] = [];
			if (schedule.signal) {
				const key = await webhookSignalKey(schedule, webhook);
				if ("error" in key) {
					errors.push(WEBHOOK_ERROR_WORDS.signalKey(key.error));
				} else {
					try {
						woke = await runs.signal(projectId, {
							name: schedule.signal.name,
							key: key.key,
							data: webhook as unknown as JsonValue,
						});
					} catch (cause) {
						console.error(
							`[webhooks] ${schedule.id} could not send its signal`,
							cause,
						);
						errors.push(wordsFor(cause));
					}
				}
			}
			if (schedule.scorePullRequests === true) {
				try {
					await scorer.take(projectId, webhook);
				} catch (cause) {
					console.error(
						`[webhooks] ${schedule.id} could not score pull requests`,
						cause,
					);
					errors.push(wordsFor(cause));
				}
			}
			if (schedule.flow !== undefined) {
				try {
					const inputs = webhookInputs(
						schedule,
						await flowInputs(projectId, schedule.flow),
						webhook,
					);
					const run = await runs.start(
						scheduledStart(projectId, schedule, schedule.flow, at, { inputs }),
						{ kind: "webhook", scheduleId: schedule.id, at },
					);
					runId = run.id;
				} catch (cause) {
					// The schedule shows why in words for people. A failure goes to the log.
					if (!(cause instanceof Refusal)) {
						console.error(
							`[webhooks] ${schedule.id} did not start a run`,
							cause,
						);
					}
					errors.push(wordsFor(cause));
				}
			}
			await log.received({
				projectId,
				scheduleId: schedule.id,
				at,
				result: "accepted",
				runId,
				woke,
				error: errors.length > 0 ? errors.join(" ") : null,
			});
		}

		const at = clock();
		const { projectId, scheduleId, headers, body } = request;
		const done = Promise.resolve();
		const schedule = await find(projectId, scheduleId);
		const secretName = schedule
			? webhookSecretName(schedule.webhook?.secret ?? "")
			: null;
		const secret = secretName
			? await secrets.value(secretName, projectId)
			: undefined;
		// The same check for an unknown schedule: the answer takes as long.
		const authentic = webhookAuthentic(headers, body, secret ?? ports.noSecret);
		if (!schedule) return { answer: { kind: "not-found" }, done };
		if (secret === undefined || secret === "") {
			refusals.add(
				projectId,
				scheduleId,
				at,
				WEBHOOK_SECRET_WORDS.noValue(secretName),
			);
			return { answer: { kind: "not-found" }, done };
		}
		if (!authentic) {
			refusals.add(
				projectId,
				scheduleId,
				at,
				headers.has("x-hub-signature-256") || headers.has("authorization")
					? WEBHOOK_SECRET_WORDS.wrong
					: WEBHOOK_SECRET_WORDS.none,
			);
			return { answer: { kind: "not-found" }, done };
		}

		const refusal = await webhookRefusal(
			schedule,
			// `NIGHTSHIFT_SCHEDULER=off`, and the Settings switch: no schedule starts.
			() => ports.switch.started() && ports.switch.on(),
			() => projects.firesHere(projectId),
		);
		if (refusal !== null) {
			refusals.add(projectId, scheduleId, at, refusal);
			return { answer: { kind: "refused", reason: refusal }, done };
		}

		const webhook = webhookEvent(
			headers.entries(),
			new TextDecoder().decode(body),
		);
		const holds = await webhookHolds(schedule, webhook);
		if ("error" in holds || !holds.holds) {
			const filtered = log.received({
				projectId,
				scheduleId,
				at,
				result: "filtered",
				runId: null,
				woke: 0,
				error: "error" in holds ? WEBHOOK_ERROR_WORDS.rule(holds.error) : null,
			});
			return { answer: { kind: "filtered" }, done: filtered };
		}
		return {
			answer: { kind: "accepted" },
			done: act(projectId, schedule, at, webhook),
		};
	};
