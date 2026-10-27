import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import {
	type FlowInputDef,
	type JsonValue,
	loadFlowSource,
	nextTimeOfDay,
	type Schedule,
	type WebhookEvent,
	webhookEvent,
	webhookHolds,
	webhookInputs,
	webhookSecretName,
	webhookSignalKey,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import { and, desc, eq, sql } from "drizzle-orm";
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import { parseEventRow, type RunLog, type RunTrigger } from "../log";
import type { RunSummary } from "../read";

/**
 * Webhooks: a schedule with `webhook` starts its flow, sends its signal, or
 * both, when a request arrives at `/hooks/<project id>/<schedule id>`. The
 * daemon's HTTP server reads the request (its body capped) and hands it
 * here; this module decides, and answers before the run starts.
 *
 * The address is public on a Host, so the rules are strict:
 * - The sender proves it knows the schedule's secret: GitHub's
 *   `X-Hub-Signature-256` (an HMAC of the body), else
 *   `Authorization: Bearer <secret>`. Both compare in constant time.
 * - An unknown project or schedule, a schedule without a webhook, and a
 *   wrong or missing secret all answer the same `not-found`, after the
 *   same work: nobody learns whether a schedule exists.
 * - Nothing logs a secret or a body. The event (the body and the headers,
 *   without the ones that carry a secret) goes only to the run it starts,
 *   as its inputs, and to the Waits it wakes, as their data.
 * - A refused webhook is never logged: anyone may send one. The last few
 *   refusals of a schedule stay in memory, so the Schedules page can say
 *   why a webhook did nothing. An authenticated one is logged
 *   (`WebhookReceived`), accepted or filtered out.
 *
 * The same Device that fires a schedule's cron times takes its webhooks
 * (`firesHere`): the one it names, else the Space's Host, else the one
 * Device of a Space without a Host.
 */

/** A webhook as the HTTP server hands it over. */
export type WebhookRequest = {
	projectId: string;
	scheduleId: string;
	headers: Headers;
	/** The raw body: the signature is over these bytes. */
	body: Uint8Array;
};

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

/** How many deliveries of a schedule the Schedules page shows. */
export const DELIVERIES_SHOWN = 10;

export type WebhooksDeps = {
	db: Database;
	now(): number;
	/** Appends `WebhookReceived`. */
	log: RunLog;
	/** The project's schedules and flows. Throws for a project it cannot read. */
	flows: Pick<ProjectFlows, "flows" | "schedules">;
	/** A secret's value by name: the keychain, then the environment. */
	secret(name: string): Promise<string | undefined>;
	/** Whether this Device takes the schedule's webhooks: the rule of its cron times. */
	firesHere(projectId: string, schedule: Schedule): Promise<boolean>;
	/** The Settings switch of every schedule. */
	enabled(): boolean;
	/** Starts a run of a flow file, with the trigger stored in `RunStarted`. */
	startRun(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/** Wakes the project's runs that wait for the signal; how many woke. */
	signal(
		projectId: string,
		signal: { name: string; key: string | null; data: JsonValue },
	): Promise<number>;
};

export type Webhooks = ReturnType<typeof createWebhooks>;

/** Whether two texts are equal, in a time that does not depend on where they differ. */
function sameText(a: string, b: string): boolean {
	const digest = (text: string) => createHash("sha256").update(text).digest();
	return timingSafeEqual(digest(a), digest(b));
}

/**
 * Whether the request proves it knows `secret`: GitHub's
 * `X-Hub-Signature-256: sha256=<hmac of the body>`, else
 * `Authorization: Bearer <secret>`.
 */
export function webhookAuthentic(
	headers: Headers,
	body: Uint8Array,
	secret: string,
): boolean {
	const signature = headers.get("x-hub-signature-256");
	if (signature !== null) {
		const expected = createHmac("sha256", secret).update(body).digest("hex");
		return sameText(signature.trim(), `sha256=${expected}`);
	}
	const bearer = /^Bearer\s+(\S.*)$/i.exec(
		headers.get("authorization")?.trim() ?? "",
	)?.[1];
	return bearer !== undefined && sameText(bearer, secret);
}

/** A key that no secret is: what a request for an unknown schedule is checked against. */
const NO_SECRET = randomBytes(32).toString("hex");

export function createWebhooks(deps: WebhooksDeps) {
	/** The latest refusals of each schedule, newest first. In memory only. */
	const refusals = new Map<string, WebhookDelivery[]>();

	const keyOf = (projectId: string, scheduleId: string) =>
		`${projectId}/${scheduleId}`;

	function refuse(
		projectId: string,
		scheduleId: string,
		at: number,
		reason: string,
	): void {
		const key = keyOf(projectId, scheduleId);
		const list = refusals.get(key) ?? [];
		list.unshift({ at, result: "refused", reason, runId: null, woke: 0 });
		refusals.set(key, list.slice(0, DELIVERIES_SHOWN));
	}

	/** The schedule, or null for any reason the sender may not learn. */
	async function find(
		projectId: string,
		scheduleId: string,
	): Promise<{ schedule: Schedule } | null> {
		try {
			const { schedules } = await deps.flows.schedules(
				{ projectId },
				{ validate: false },
			);
			// A duplicate id is an issue in the UI; the first one counts.
			const schedule = schedules.find((s) => s.id === scheduleId);
			return schedule?.webhook ? { schedule } : null;
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
			const set = await deps.flows.flows({ projectId });
			return loadFlowSource(set.sources, flow, set.pathOf).flow?.inputs ?? [];
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
				errors.push(`The signal's key failed: ${key.error}`);
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
		if (schedule.flow !== undefined) {
			const stopAt = schedule.stopAt
				? (nextTimeOfDay(schedule.stopAt, at) ?? undefined)
				: undefined;
			try {
				const inputs = webhookInputs(
					schedule,
					await flowInputs(projectId, schedule.flow),
					webhook,
				);
				const run = await deps.startRun(
					{
						projectId,
						flowName: schedule.flow,
						inputs,
						...(schedule.baseRef ? { baseRef: schedule.baseRef } : {}),
						...(stopAt !== undefined ? { stopAt } : {}),
						...(schedule.person ? { startedBy: schedule.person } : {}),
					},
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
		await deps.log.append({
			type: "WebhookReceived",
			payload: {
				projectId,
				scheduleId: schedule.id,
				at,
				result: "accepted",
				runId,
				woke,
				error: errors.length > 0 ? errors.join(" ") : null,
			},
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
			const secret = secretName ? await deps.secret(secretName) : undefined;
			// The same check for an unknown schedule: the answer takes as long.
			const authentic = webhookAuthentic(headers, body, secret ?? NO_SECRET);
			if (!found) return { answer: { kind: "not-found" }, done };
			if (secret === undefined || secret === "") {
				refuse(
					projectId,
					scheduleId,
					at,
					`The secret ${secretName ?? "of this schedule"} has no value on this computer. Add it under Agents, Secrets.`,
				);
				return { answer: { kind: "not-found" }, done };
			}
			if (!authentic) {
				refuse(
					projectId,
					scheduleId,
					at,
					headers.has("x-hub-signature-256") || headers.has("authorization")
						? "The secret did not match."
						: "It came without the secret.",
				);
				return { answer: { kind: "not-found" }, done };
			}

			const { schedule } = found;
			const refusal = !schedule.enabled
				? "The schedule is paused."
				: !deps.enabled()
					? "Schedules are paused."
					: !(await deps.firesHere(projectId, schedule))
						? "Another device runs this schedule. Send the webhook there."
						: null;
			if (refusal !== null) {
				refuse(projectId, scheduleId, at, refusal);
				return { answer: { kind: "refused", reason: refusal }, done };
			}

			const webhook = webhookEvent(
				headers.entries(),
				new TextDecoder().decode(body),
			);
			const holds = await webhookHolds(schedule, webhook);
			if ("error" in holds || !holds.holds) {
				const filtered = deps.log
					.append({
						type: "WebhookReceived",
						payload: {
							projectId,
							scheduleId,
							at,
							result: "filtered",
							runId: null,
							woke: 0,
							error:
								"error" in holds ? `The rule failed: ${holds.error}` : null,
						},
					})
					.then(() => {});
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
			const rows = await deps.db
				.select()
				.from(event)
				.where(
					and(
						eq(event.type, "WebhookReceived"),
						sql`json_extract(${event.payload}, '$.projectId') = ${projectId}`,
						sql`json_extract(${event.payload}, '$.scheduleId') = ${scheduleId}`,
					),
				)
				.orderBy(desc(event.seq))
				.limit(DELIVERIES_SHOWN);
			const logged: WebhookDelivery[] = [];
			for (const row of rows) {
				const e = parseEventRow(row);
				if (e.type !== "WebhookReceived") continue;
				const { at, result, runId, woke, error } = e.payload;
				logged.push({ at, result, reason: error, runId, woke });
			}
			return [...logged, ...(refusals.get(keyOf(projectId, scheduleId)) ?? [])]
				.sort((a, b) => b.at - a.at)
				.slice(0, DELIVERIES_SHOWN);
		},
	};
}
