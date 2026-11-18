import { randomBytes } from "node:crypto";
import type { Database } from "@nightshift/db";
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
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import type { RunLog, RunTrigger } from "../log";
import type { RunSummary } from "../read";
import { drizzleScheduleLog } from "./adapters/out/drizzle-schedule-log";
import { scheduledStart } from "./domain/scheduled-start";
import {
	createWebhookRefusals,
	DELIVERIES_SHOWN,
	latestDeliveries,
	WEBHOOK_ERROR_WORDS,
	WEBHOOK_SECRET_WORDS,
	type WebhookAnswer,
	type WebhookDelivery,
	webhookRefusal,
	webhookScheduleOf,
} from "./domain/webhook-delivery";
import { webhookAuthentic } from "./domain/webhook-proof";

/**
 * Webhooks: the daemon's HTTP server reads the request (its body capped)
 * and hands it here. This module decides, and answers before the run
 * starts. The rules are in `domain/webhook-delivery.ts`.
 */

/** A webhook as the HTTP server hands it over. */
export type WebhookRequest = {
	projectId: string;
	scheduleId: string;
	headers: Headers;
	/** The raw body: the signature is over these bytes. */
	body: Uint8Array;
};

export type WebhooksDeps = {
	db: Database;
	now(): number;
	/** Appends `WebhookReceived`. */
	log: RunLog;
	/** The project's schedules and flows. Throws for a project it cannot read. */
	flows: Pick<ProjectFlows, "flows" | "schedules">;
	/** A schedule's secret by name: its project's first. */
	secret(name: string, projectId: string): Promise<string | undefined>;
	/** Whether this Device takes the schedule's webhooks: the rule of its cron times. */
	firesHere(projectId: string, schedule: Schedule): Promise<boolean>;
	/** The Settings switch of every schedule. */
	enabled(): boolean;
	/** Starts a run of a flow file, with the trigger stored in `RunStarted`. */
	startRun(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/**
	 * Scores the project's runs by what a GitHub webhook says about their
	 * pull requests (`pull-request-scores.ts`); how many scores it wrote.
	 */
	scorePullRequests(projectId: string, webhook: WebhookEvent): Promise<number>;
	/** Wakes the project's runs that wait for the signal; how many woke. */
	signal(
		projectId: string,
		signal: { name: string; key: string | null; data: JsonValue },
	): Promise<number>;
};

export type Webhooks = ReturnType<typeof createWebhooks>;

/** A key that no secret is: what a request for an unknown schedule is checked against. */
const NO_SECRET = randomBytes(32).toString("hex");

export function createWebhooks(deps: WebhooksDeps) {
	/** The latest refusals of each schedule. In memory only. */
	const refusals = createWebhookRefusals();
	const log = drizzleScheduleLog({ db: deps.db, log: deps.log });

	/** The schedule, or null for any reason the sender may not learn. */
	async function find(
		projectId: string,
		scheduleId: string,
	): Promise<{ schedule: Schedule } | null> {
		try {
			const { schedules } = await deps.flows.schedules(projectId, {
				validate: false,
			});
			const schedule = webhookScheduleOf(schedules, scheduleId);
			return schedule ? { schedule } : null;
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
			const sources = await deps.flows.flows(projectId);
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
					woke = await deps.signal(projectId, {
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
				await deps.scorePullRequests(projectId, webhook);
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
				const run = await deps.startRun(
					scheduledStart(projectId, schedule, schedule.flow, at, { inputs }),
					{ kind: "webhook", scheduleId: schedule.id, at },
				);
				runId = run.id;
			} catch (cause) {
				// The schedule shows why in words for people. A failure goes to the log.
				if (!(cause instanceof Refusal)) {
					console.error(`[webhooks] ${schedule.id} did not start a run`, cause);
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

	return {
		/**
		 * Takes one webhook: the answer for the sender, and `done`, the work
		 * that goes on after it (the run's start, the signal, the log).
		 */
		async receive(
			request: WebhookRequest,
		): Promise<{ answer: WebhookAnswer; done: Promise<void> }> {
			const at = deps.now();
			const { projectId, scheduleId, headers, body } = request;
			const done = Promise.resolve();
			const found = await find(projectId, scheduleId);
			const secretName = found
				? webhookSecretName(found.schedule.webhook?.secret ?? "")
				: null;
			const secret = secretName
				? await deps.secret(secretName, projectId)
				: undefined;
			// The same check for an unknown schedule: the answer takes as long.
			const authentic = webhookAuthentic(headers, body, secret ?? NO_SECRET);
			if (!found) return { answer: { kind: "not-found" }, done };
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

			const { schedule } = found;
			const refusal = await webhookRefusal(
				schedule,
				() => deps.enabled(),
				() => deps.firesHere(projectId, schedule),
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
					error:
						"error" in holds ? WEBHOOK_ERROR_WORDS.rule(holds.error) : null,
				});
				return { answer: { kind: "filtered" }, done: filtered };
			}
			return {
				answer: { kind: "accepted" },
				done: act(projectId, schedule, at, webhook),
			};
		},

		/** The latest webhooks of a schedule, newest first: logged ones and refusals. */
		async deliveries(
			projectId: string,
			scheduleId: string,
		): Promise<WebhookDelivery[]> {
			return latestDeliveries(
				await log.deliveries(projectId, scheduleId, DELIVERIES_SHOWN),
				refusals.of(projectId, scheduleId),
			);
		},
	};
}
