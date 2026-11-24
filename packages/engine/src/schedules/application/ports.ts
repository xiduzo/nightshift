import type {
	FlowSources,
	JsonValue,
	Schedule,
	ScheduleIssue,
	WebhookEvent,
} from "@nightshift/flows";
import type { Actor, OffersPort, StartRunInput } from "../../contract";
import type { RunTrigger } from "../../log";
import type { RunSummary } from "../../read";
import type { RunStatus } from "../../run-status";
import type {
	ScheduleFiredFact,
	ScheduleHistories,
	ScheduleSkippedFact,
} from "../domain/schedule-history";
import type { MissedScheduleTime } from "../domain/schedule-watch";
import type {
	WebhookDelivery,
	WebhookReceivedFact,
} from "../domain/webhook-delivery";

/**
 * The driven ports of the schedules slice. Two are its own, each with a
 * real adapter, an in-memory adapter and a contract suite in
 * `adapters/out/`: `ScheduleStore` and `ScheduleLog`. Another slice or
 * package fills the others (`@filledBy`): `createEngine` passes them to
 * `wireSchedules`.
 */

/** The schedules of a project, as its flow document keeps them. */
export type ScheduleStore = {
	/**
	 * The project's schedules, in their saved order. `validate` (default
	 * true) checks each against the project's flows. Throws for a project
	 * it cannot read.
	 */
	list(
		projectId: string,
		options?: { validate?: boolean },
	): Promise<{ path: string; schedules: Schedule[]; issues: ScheduleIssue[] }>;
	/** Saves the project's schedules, those with problems too. Returns the issues. */
	save(
		projectId: string,
		schedules: readonly Schedule[],
	): Promise<ScheduleIssue[]>;
	/** The project's flows by name: what a schedule starts. */
	flows(projectId: string): Promise<FlowSources>;
};

/**
 * The schedules a leave of a Host paused on this computer only. None in a
 * Space a Host keeps: that Host fires them.
 * @filledBy devices
 */
export type PausedHere = {
	/** The ids of the project's schedules that are paused here. */
	of(projectId: string): Promise<ReadonlySet<string>>;
	/** A person turned these on here, or removed them. */
	ended(projectId: string, scheduleIds: readonly string[]): Promise<void>;
};

/** What the event log knows of schedules, and the facts the slice adds to it. */
export type ScheduleLog = {
	/**
	 * Reads the schedule facts the log gained since the last call. Returns
	 * the histories: one live view, which a later `fired` or `skipped`
	 * changes at once.
	 */
	histories(): Promise<ScheduleHistories>;
	/** A cron time started a run, or its start failed. */
	fired(fact: ScheduleFiredFact): Promise<void>;
	/** A cron time did not start. */
	skipped(fact: ScheduleSkippedFact): Promise<void>;
	/** A webhook whose secret checked out arrived. A refused one is never logged. */
	received(fact: WebhookReceivedFact): Promise<void>;
	/** The logged webhooks of one schedule, newest first, at most `limit`. */
	deliveries(
		projectId: string,
		scheduleId: string,
		limit: number,
	): Promise<WebhookDelivery[]>;
};

/**
 * The runs a schedule starts, asks about and wakes.
 * @filledBy engine/wire
 */
export type ScheduledRuns = {
	/**
	 * Starts a run of a flow where a schedule's run starts: on the Host
	 * that keeps the Space, else here (ADR 15). The trigger is stored with
	 * the start.
	 */
	start(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/** The run's status, or null when the log knows no such run. */
	status(runId: string): Promise<RunStatus | null>;
	/** Wakes the project's runs that wait for the signal. Returns how many woke. */
	signal(
		projectId: string,
		signal: { name: string; key: string | null; data: JsonValue },
	): Promise<number>;
	/** What hides the worktree paths of a run on a Device the actor does not own. */
	shownTo(
		spaceId: string,
		actor: Actor,
	): Promise<(run: RunSummary) => Promise<RunSummary>>;
};

/**
 * The projects whose schedules count here.
 * @filledBy engine/wire
 */
export type ScheduledProjects = {
	/** The projects a person has not removed, also one without a Clone here. */
	all(): Promise<{ id: string }[]>;
	/**
	 * The project when it is in the Space. Throws (`not-found`) for a
	 * project of another Space, a removed one, or none: one answer for all.
	 */
	inSpace(
		projectId: string,
		spaceId: string,
	): Promise<{ hasFolder: boolean; clonedHere: boolean }>;
	/**
	 * Whether this Device fires the project's schedules and takes their
	 * webhooks: the Space's Host, else the one Device of a Space without a
	 * Host. So a schedule that every Clone reads fires once (ADR 15).
	 */
	firesHere(projectId: string): Promise<boolean>;
};

/**
 * The Offer rule of a schedule on another Person's Device.
 * @filledBy devices
 */
export type ScheduleOffers = OffersPort;

/**
 * Scores the project's runs by what a GitHub webhook says of their pull
 * requests. Returns how many scores it wrote.
 * @filledBy engine/scores
 */
export type PullRequestScorer = {
	take(projectId: string, webhook: WebhookEvent): Promise<number>;
};

/**
 * A schedule's secret by name, its project's first.
 * @filledBy engine/wire
 */
export type WebhookSecrets = {
	value(name: string, projectId: string): Promise<string | undefined>;
};

/**
 * The two switches of every schedule.
 * @filledBy engine/wire
 */
export type ScheduleSwitch = {
	/** The Settings switch, read each time. Off: no cron time starts, like a pause of every schedule. */
	on(): boolean;
	/** Whether this engine started its scheduler at all (`NIGHTSHIFT_SCHEDULER=off`: no). */
	started(): boolean;
};

/**
 * What the slice tells the rest of Night Shift.
 * @filledBy engine/wire
 */
export type ScheduleNotices = {
	/**
	 * A project's schedules changed without a run (a pause tonight): the
	 * open screens of the Space read them again. It waits until they are
	 * told, and what it throws fails the request.
	 */
	changed(spaceId: string, projectId: string): Promise<void>;
	/** A cron time was missed by more than its schedule allows. */
	missed(time: MissedScheduleTime): void;
};

/**
 * The time now (epoch ms).
 * @filledBy engine/wire
 */
export type Clock = () => number;
