import { randomBytes } from "node:crypto";
import type { Database } from "@nightshift/db";
import type { JsonValue, WebhookEvent } from "@nightshift/flows";
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import type { RunLog, RunTrigger } from "../log";
import type { RunSummary } from "../read";
import { drizzleScheduleLog } from "./adapters/out/drizzle-schedule-log";
import { receiveWebhook } from "./application/receive-webhook";
import { createWebhookRefusals } from "./domain/webhook-delivery";

/**
 * Webhooks, as the engine still makes them: a facade that binds the use
 * case (`application/receive-webhook.ts`) to its ports. The daemon's HTTP
 * server reads the request (its body capped) and hands it over. It goes
 * when `wire.ts` binds the use case.
 */

export type WebhooksDeps = {
	db: Database;
	now(): number;
	/** Appends `WebhookReceived`. */
	log: RunLog;
	/** The project's schedules and flows. Throws for a project it cannot read. */
	flows: Pick<ProjectFlows, "flows" | "schedules">;
	/** A schedule's secret by name: its project's first. */
	secret(name: string, projectId: string): Promise<string | undefined>;
	/** Whether this Device takes the project's webhooks: the rule of its cron times. */
	firesHere(projectId: string): Promise<boolean>;
	/** Whether this engine started its scheduler at all (`NIGHTSHIFT_SCHEDULER=off`: no). */
	started(): boolean;
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

export function createWebhooks(deps: WebhooksDeps) {
	/** The latest refusals of each schedule. In memory only. */
	const refusals = createWebhookRefusals();

	return {
		/**
		 * Takes one webhook: the answer for the sender, and `done`, the work
		 * that goes on after it (the run's start, the signal, the log).
		 */
		receive: receiveWebhook({
			clock: () => deps.now(),
			store: {
				list: (projectId, options) => deps.flows.schedules(projectId, options),
				flows: (projectId) => deps.flows.flows(projectId),
			},
			secrets: { value: (name, projectId) => deps.secret(name, projectId) },
			switch: { on: () => deps.enabled(), started: () => deps.started() },
			projects: { firesHere: (projectId) => deps.firesHere(projectId) },
			runs: { signal: deps.signal, start: deps.startRun },
			scorer: { take: deps.scorePullRequests },
			log: drizzleScheduleLog({ db: deps.db, log: deps.log }),
			refusals,
			// A key that no secret is: what a request for an unknown schedule is checked against.
			noSecret: randomBytes(32).toString("hex"),
		}),
		/** The refused webhooks of this engine: what the Schedules page lists beside the logged ones. */
		refusals,
	};
}
