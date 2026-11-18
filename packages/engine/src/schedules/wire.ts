import { randomBytes } from "node:crypto";
import type { UsageNotes } from "../usage";
import {
	createScheduleTicker,
	DEFAULT_SCHEDULE_TICK_MS,
	type ScheduleTicker,
} from "./adapters/in/schedule-ticker";
import {
	type DrizzleScheduleLogDeps,
	drizzleScheduleLog,
} from "./adapters/out/drizzle-schedule-log";
import {
	type FlowDocumentScheduleStoreDeps,
	flowDocumentScheduleStore,
} from "./adapters/out/flow-document-schedule-store";
import { fireDueSchedules } from "./application/fire-due-schedules";
import { listSchedules } from "./application/list-schedules";
import { pauseScheduleTonight } from "./application/pause-schedule-tonight";
import type {
	Clock,
	PullRequestScorer,
	ScheduledProjects,
	ScheduledRuns,
	ScheduleNotices,
	ScheduleOffers,
	ScheduleSwitch,
	WebhookSecrets,
} from "./application/ports";
import { previewCron } from "./application/preview-cron";
import { receiveWebhook } from "./application/receive-webhook";
import { resumeScheduleTonight } from "./application/resume-schedule-tonight";
import { runScheduleNow } from "./application/run-schedule-now";
import { saveSchedules } from "./application/save-schedules";
import { createScheduleWatch } from "./domain/schedule-watch";
import { createWebhookRefusals } from "./domain/webhook-delivery";

/**
 * The wiring of the schedules slice: the one place that builds its real
 * adapters (the schedules in the flow documents, the schedule facts of
 * the event log) and its long-lived domain objects (the watch, the
 * refused webhooks), and binds each use case to its ports.
 */

/** What the engine gives the slice: the ports that another slice or package fills, and what the real adapters stand on. */
export type SchedulesDeps = {
	/** The event log: the database the facts are read from, and what appends to it. */
	log: DrizzleScheduleLogDeps;
	/** The flows slice: the schedules and flows of each project, in its flow document. */
	flows: FlowDocumentScheduleStoreDeps;
	clock: Clock;
	/** How often the scheduler looks for due schedules. Default 30 000 ms. */
	tickMs?: number;
	runs: ScheduledRuns;
	projects: ScheduledProjects;
	offers: ScheduleOffers;
	scorer: PullRequestScorer;
	secrets: WebhookSecrets;
	switch: ScheduleSwitch;
	notices: ScheduleNotices;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
};

/** The use cases of the slice, bound to their ports, and the ticker of its scheduler. */
export type Schedules = {
	/** The schedules of a project as a person reads them. */
	list: ReturnType<typeof listSchedules>;
	/** Saves the schedules of a project. */
	save: ReturnType<typeof saveSchedules>;
	/** Pauses one schedule tonight. */
	pauseTonight: ReturnType<typeof pauseScheduleTonight>;
	/** Ends one schedule's pause tonight. */
	resumeTonight: ReturnType<typeof resumeScheduleTonight>;
	/** Starts one schedule's run now. */
	runNow: ReturnType<typeof runScheduleNow>;
	/** Reads a cron line for the person who types it. */
	previewCron: ReturnType<typeof previewCron>;
	/** Takes one webhook for a schedule. */
	receiveWebhook: ReturnType<typeof receiveWebhook>;
	/**
	 * The timer that fires the due schedules. The engine starts it when it
	 * is ready, stops it for good, and holds it while Projects move.
	 */
	ticker: ScheduleTicker;
};

/**
 * Wires the slice. Call it while the engine is made, not later: the
 * watch of the scheduler begins at this moment, and a cron time before it
 * counts as one that fell while the daemon was down.
 */
export function wireSchedules(deps: SchedulesDeps): Schedules {
	const ports = {
		clock: deps.clock,
		runs: deps.runs,
		projects: deps.projects,
		offers: deps.offers,
		scorer: deps.scorer,
		secrets: deps.secrets,
		switch: deps.switch,
		notices: deps.notices,
		...(deps.usage ? { usage: deps.usage } : {}),
		store: flowDocumentScheduleStore(deps.flows),
		log: drizzleScheduleLog(deps.log),
		watch: createScheduleWatch(deps.clock()),
		refusals: createWebhookRefusals(),
		// A key that no secret is: what a webhook for an unknown schedule is checked against.
		noSecret: randomBytes(32).toString("hex"),
	};
	return {
		list: listSchedules(ports),
		save: saveSchedules(ports),
		pauseTonight: pauseScheduleTonight(ports),
		resumeTonight: resumeScheduleTonight(ports),
		runNow: runScheduleNow(ports),
		previewCron: previewCron(ports),
		receiveWebhook: receiveWebhook(ports),
		ticker: createScheduleTicker({
			tickMs: deps.tickMs ?? DEFAULT_SCHEDULE_TICK_MS,
			fire: fireDueSchedules(ports),
		}),
	};
}
