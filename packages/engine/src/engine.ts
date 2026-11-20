import type { AnswerCost } from "./assistant";
import type { Actor, LeaseHost, MemberChange } from "./contract";
import type { Dashboard } from "./dashboard";
import { type SpaceDocuments, spaceUsageOn } from "./documents";
import type { ProjectFlows } from "./flows";
import type { Runner } from "./graph";
import type { createLeaseKeeper, createLeaseStore } from "./leases";
import {
	type createLandedFeed,
	type LandedScope,
	logMemberChange,
	type RunLog,
} from "./log";
import { type LandedFact, landedFacts, type RunTrace } from "./read";
import type { RunHere, Views } from "./runs";
import type {
	ScheduleMissed,
	Schedules,
	WebhookAnswer,
	WebhookRequest,
} from "./schedules";
import type { createPullRequestWatch } from "./scores";
import type { SpaceEngine } from "./space-engine";
import type { MovedProjects, ProjectsMove, SpaceMove } from "./space-move";
import type { wireEngineAccess } from "./wire-access";
import type { wireEngineActions } from "./wire-actions";
import type { wireEngineAnswerCosts } from "./wire-answer-costs";
import type { wireEngineGates } from "./wire-gates";
import type { wireEngineMove } from "./wire-move";
import type { createScheduleNotices } from "./wire-schedules";
import type { wireEngineStart } from "./wire-start";
import type { wireEngineViews } from "./wire-views";

/**
 * The engine as its callers hold it: the `Engine` interface, the knobs of
 * a test (`EngineInternals`), and the thin object behind the interface
 * (`engineOf`). `createEngine` (`wire.ts`) makes the pieces and hands them
 * over. A member waits for the engine to be ready and calls one piece. It
 * holds no rule.
 */

/**
 * The engine of this Device. Its background work (the walk, recovery, the
 * scheduler) covers every Space the Device holds, and writes each row with
 * its own Space. What a person does goes through one Space's view.
 */
export interface Engine {
	/**
	 * What a person does in one Space. Nothing it reads, returns or changes
	 * is of another Space: a project or run of another Space is "not found".
	 * `actor` is who acts: a Person, with the door their request came
	 * through, whose role in the Space each use case checks. An action on
	 * a run walked elsewhere travels to its Walker in their name. A caller
	 * in this process that acts for no Person passes `NIGHT_SHIFT`.
	 */
	space(spaceId: string, actor: Actor): SpaceEngine;
	/**
	 * Keeps what one answer of one of Night Shift's own agents cost on this
	 * computer. The Spend page of its Space reads it
	 * (`SpaceEngine.listAnswerCosts`).
	 */
	keepAnswerCost(cost: AnswerCost): Promise<void>;
	/**
	 * Logs a change of a Space's Members in that Space's event log
	 * (`MemberJoined`, `MemberRemoved`, `MemberRoleChanged`), with who made it.
	 */
	logMemberChange(change: MemberChange): Promise<void>;
	/**
	 * Calls `listener` with what each run event that lands in this Replica
	 * from now on means (the landed facts): appended here, or brought by
	 * the exchange from another Walker. Each carries its Space, with no
	 * query (the landed feed). The notifier reads Gates, device waits and
	 * run endings from it. Returns the unsubscribe.
	 */
	/**
	 * The leases of the Spaces this Replica keeps (ADR 7). It serves the
	 * runs its paired Devices walk (`leases.*` of the peer protocol).
	 */
	leases: LeaseHost;
	onLandedFacts(
		listener: (facts: readonly LandedFact[]) => void,
		scope?: LandedScope,
	): () => void;
	/**
	 * Calls `listener` when this Replica's scheduler skips a cron time
	 * that was missed by more than its schedule allows (`lateMinutes`).
	 * Not for a pause or an earlier run that still runs. The notifier tells
	 * the Space of it. Returns the unsubscribe.
	 */
	onScheduleMissed(listener: (missed: ScheduleMissed) => void): () => void;
	/**
	 * Calls `listener` when a project's schedules changed without a run (a
	 * pause tonight), and waits for it: the daemon tells the open screens
	 * of the Space. Returns the unsubscribe.
	 */
	onSchedulesChanged(
		listener: (spaceId: string, projectId: string) => Promise<void>,
	): () => void;
	/**
	 * Moves Projects from one Space to others, as one operation (a Space
	 * move, `space-move/`): no run becomes active in `move.from` and
	 * no schedule fires from the caller's `plan` through the batch, the
	 * schedules change through `ProjectFlows`, every row of the Projects
	 * and of the packages above the engine (`EngineOptions.moveRows`)
	 * moves in one batch with the caller's own, the run log reads the moved
	 * runs again, and the Space documents this Replica writes follow. A
	 * person's move of a Project, the merge of Personal into the home
	 * Host's and its split off it all go through it.
	 */
	moveProjects(move: ProjectsMove): Promise<MovedProjects>;
	/**
	 * Forgets a Space a move emptied: its facts of no run here (a Member
	 * that joined) and its Space document. False, and nothing removed,
	 * while the Space's own row, a Project or a run of it is still here.
	 * The caller removes the Space's row first (`@nightshift/auth`), and
	 * checks it too. Runs again safely.
	 */
	forgetSpace(spaceId: string): Promise<boolean>;
	/**
	 * The flows of every Project of this Replica, by Project, whatever its
	 * Space (`ProjectFlows`): what another Device's older Walker asks this
	 * one for, and the merge of one Project's flows into another's (the
	 * merge of Personal). Who may see the Project is the caller's check. A
	 * person reads and saves through `space(id).flows`.
	 */
	readonly flows: Pick<
		ProjectFlows,
		"flows" | "schedules" | "planMerge" | "merge"
	>;
	/**
	 * Whether this computer may send anonymous usage. False when any Space
	 * it belongs to has usage turned off. Missing means on.
	 */
	usageAllowed(): Promise<boolean>;
	/**
	 * A run's status, when it wakes, and whether this computer walks it or
	 * runs its steps, in any Space of this Replica. Null for a run it does
	 * not have. Cheap: one row and the facts the run log keeps, for a
	 * reader that asks on every landed event (keep this computer awake).
	 */
	runHere(runId: string): Promise<RunHere | null>;
	/**
	 * A run as an export to monitoring reads it (`read/run-trace.ts`): its
	 * walks and steps with their ends, sessions, Gates' waits and sleeps.
	 * Null for a run this Replica has no events of. One derivation per
	 * append, shared with every other reader of the run.
	 */
	runTrace(runId: string): Promise<RunTrace | null>;
	/**
	 * A Device is back (its link to this Host took work again): the steps
	 * of the runs this computer walks that sleep because a Device was
	 * offline look again now, instead of at their next try.
	 */
	deviceBack(deviceId: string): Promise<void>;
	/**
	 * This computer's link to a Host is online again: the leases of the
	 * runs it walks are renewed now, not at the next minute. The renewal
	 * at the start does not reach a Host before its link is up. It waits
	 * for recovery, as that renewal does.
	 */
	hostBack(): Promise<void>;
	/**
	 * Asks GitHub about each pull request a run on this computer opened,
	 * until it is merged or closed. Does nothing when this computer has no
	 * `gh`. The morning check calls this; a test can call it too.
	 */
	scoreOpenPullRequests(): Promise<void>;
	/**
	 * A webhook for a schedule (`POST /hooks/<project>/<schedule>`): the
	 * answer for its sender, and `done`, the run's start and the signal
	 * that follow it (`schedules/webhooks.ts`). Never throws for a request
	 * nobody may know about: that is `not-found`.
	 */
	webhook(
		request: WebhookRequest,
	): Promise<{ answer: WebhookAnswer; done: Promise<void> }>;
	/**
	 * Hands this computer's runs over to a new engine in the same process
	 * (`bun --hot` evaluates the daemon again). Stops the scheduler, the
	 * resumes and the wake timers, and lets go of every run this engine
	 * drives: each drive writes nothing more and its harness is aborted.
	 * The log is left as it is, so the next engine's recovery finds the
	 * open work, ends it `interrupted` and continues it, as after a
	 * restart. Resolves once the drives' writes in flight settled.
	 */
	dispose(): Promise<void>;
	/**
	 * The run use cases for a door that holds the actor (decision 41 of
	 * the hexagon series). Each opens the run, finds its Space and decides
	 * who may. Each waits for the engine to be ready.
	 */
	readonly runs: RunUseCases;
	/**
	 * The Gate use cases for a door that holds the actor (decision 41 of
	 * the hexagon series): the answer to a Gate, which opens its run and
	 * decides who may, and the Needs-you inbox of a Person. Each waits for
	 * the engine to be ready.
	 */
	readonly gates: GateUseCases;
	/**
	 * What the answers of Night Shift's own agents cost, as a Host and its
	 * Devices exchange them (`sync.answerCosts`): a Device's half and a
	 * Host's half. They do not wait for the engine to be ready.
	 */
	readonly answerCosts: SharedAnswerCosts;
	/**
	 * The dashboard's numbers for a door that holds the actor (G8 of the
	 * hexagon series): one project, Spaces, the spend, one flow's health and
	 * changes, and whether a run's end turned its flow severe. Each reads
	 * through the Space view, which waits for the engine to be ready.
	 */
	readonly dashboard: Dashboard;
}

/**
 * The run use cases of `Engine.runs`. Each block of the run path gives its
 * own (`runs` of its `wire-*.ts` file): access gives `open`, the actions
 * give `act`, `stop`, `resume`, `restartStep`, `rerun`, `signal`,
 * `releaseLease`, `markUseful` and `takeOver`, the start gives `start`, the
 * move gives `move` and `moveTargets`, the views give `list`, `get`, `step`,
 * `stepTranscript` and `watch`.
 */
export type RunUseCases = ReturnType<typeof wireEngineAccess>["runs"] &
	ReturnType<typeof wireEngineActions>["runs"] &
	ReturnType<typeof wireEngineStart>["runs"] &
	ReturnType<typeof wireEngineMove>["runs"] &
	ReturnType<typeof wireEngineViews>["runs"];

/** The reads of `Engine.runs` (`wire-views.ts`). */
type ViewRuns = ReturnType<typeof wireEngineViews>["runs"];

/** The Gate use cases of `Engine.gates`: `answer`, `inbox`, `answeredInbox` (`wire-gates.ts`). */
export type GateUseCases = ReturnType<typeof wireEngineGates>["cases"];

/** The answer costs of `Engine.answerCosts`: `unsent`, `sent`, `cursors`, `ingest`, `take`, `after` (`wire-answer-costs.ts`). */
export type SharedAnswerCosts = ReturnType<
	typeof wireEngineAnswerCosts
>["shared"];

/** Knobs for tests only. Not part of the engine contract. */
export type EngineInternals = {
	/** How long one minute of a node's `timeoutMinutes`, `idleMinutes` or a policy wait lasts. Default 60 000 ms. */
	minuteMs?: number;
	/** How long one second of a service's probe (`everySeconds`, `timeoutMinutes`) lasts. Default 1 000 ms. */
	secondMs?: number;
	/** The clock for waits and the stop time. Default `now`. */
	now?: () => number;
	/** Aborting it clears the engine's wake timers and stops its scheduler: a test's way to let a daemon die. */
	signal?: AbortSignal;
	/** How often the scheduler looks for due schedules. Default 30 000 ms. */
	scheduleTickMs?: number;
	/** How long after its start the engine resumes the runs recovery interrupted. Default 5 000 ms. */
	resumeGraceMs?: number;
	/** The run log the engine reads and appends through. Default: a new one on `options.db`. */
	runLog?: RunLog;
	/** How often the runner looks for steps past their time limits that their timers missed. Default 5 000 ms. */
	overdueSweepMs?: number;
	/** How long after the engine is ready the cleanup of run copies and run folders first sweeps. Default 60 000 ms. */
	cleanupDelayMs?: number;
	/** How often the cleanup of run copies and run folders sweeps. Default 6 h. */
	cleanupEveryMs?: number;
	/** Called when a round of the cleanup ended: a test waits for this, not for a time. */
	cleanupSwept?: () => void;
};

/**
 * What `createEngine` hands the thin object: the pieces its members call.
 * The lanes of the hexagon series each own one block of it.
 */
export type EngineParts = {
	/** Settles when the engine is ready. Every member waits for it and sees its error there. */
	ready: Promise<unknown>;
	/** Settles when startup recovery ended. `hostBack` waits for no more than that. */
	recovered: Promise<unknown>;
	/** The engine's lifetime: `dispose` ends it. */
	lifetime: AbortController;
	/** What a person does in one Space (`space.ts`). */
	space: Engine["space"];
	log: RunLog;
	documents: Pick<SpaceDocuments, "openAll">;
	flows: Engine["flows"];
	/** The Space move (SM, `wire-space-move.ts`). */
	spaceMove: Pick<SpaceMove, "moveProjects" | "forgetSpace">;
	leaseStore: Pick<
		ReturnType<typeof createLeaseStore>,
		"take" | "renew" | "release"
	>;
	leases: Pick<ReturnType<typeof createLeaseKeeper>, "renewAll">;
	landed: Pick<ReturnType<typeof createLandedFeed>, "subscribe" | "close">;
	runner: Pick<Runner, "release">;
	/** The run use cases (`Engine.runs`) of the blocks but the views, before the engine is ready. */
	runs: Omit<RunUseCases, keyof ViewRuns>;
	/** The Gate use cases (`Engine.gates`), before the engine is ready. */
	gates: GateUseCases;
	/** What answers cost (`wire-answer-costs.ts`): the keep of one, and `Engine.answerCosts`. */
	answerCosts: Pick<
		ReturnType<typeof wireEngineAnswerCosts>,
		"keep" | "shared"
	>;
	/** The dashboard's use cases (`wire-dashboard.ts`). */
	dashboard: Dashboard;

	// --- schedules and scores (`wire-schedules.ts`) ---
	scheduleNotices: Pick<
		ReturnType<typeof createScheduleNotices>,
		"onMissed" | "onChanged"
	>;
	schedules: Pick<Schedules, "receiveWebhook">;
	pullRequestWatch: Pick<ReturnType<typeof createPullRequestWatch>, "score">;

	// --- views (R2, `wire-views.ts`) ---
	views: { cases: Pick<Views, "readRunHere" | "readRunTrace">; runs: ViewRuns };

	// --- recovery (R7, `wire-recovery.ts`) ---
	/** The runs here that wait for a lease ask again. It does not wait, and it never throws. */
	wakeLeaseSleeps(): void;
	/** The steps here that sleep because a Device was offline look again. */
	wakeOfflineSleeps(): Promise<void>;
};

/**
 * The engine over its pieces. Each member is the old member of
 * `createEngine`, word for word. The members stand in blocks, one for
 * each owner: a lane changes only its own block.
 */
export function engineOf(parts: EngineParts): Engine {
	const {
		ready,
		recovered,
		lifetime,
		space,
		log: runLog,
		documents,
		flows: projectFlows,
		spaceMove,
		leaseStore,
		leases,
		landed,
		runner,
		scheduleNotices,
		schedules,
		pullRequestWatch,
		views,
	} = parts;

	return {
		// --- the Space view (`space.ts`) ---
		space,

		// --- Spaces, Members and Projects (phase 3) ---
		async keepAnswerCost(cost) {
			await ready;
			await parts.answerCosts.keep(cost);
		},
		logMemberChange: (change) => logMemberChange(runLog, change),
		async moveProjects(move) {
			await ready;
			return spaceMove.moveProjects(move);
		},
		async forgetSpace(spaceId) {
			await ready;
			return spaceMove.forgetSpace({ spaceId });
		},
		flows: projectFlows,
		async usageAllowed() {
			await ready;
			const spaces = await documents.openAll();
			return spaces.every(spaceUsageOn);
		},

		// --- leases. The wake in `release` is the recovery block's (R7) ---
		leases: {
			take: (take) => leaseStore.take(take),
			renew: (input) => leaseStore.renew(input),
			// A lease a Device's run lets go of here wakes the runs here that wait.
			release: async (input) => {
				await leaseStore.release(input);
				parts.wakeLeaseSleeps();
			},
		},
		async hostBack() {
			// After recovery, as at the start. Not after the rest of `ready`.
			await recovered;
			await leases.renewAll();
		},

		// --- the landed facts ---
		onLandedFacts: (listener, scope) =>
			landed.subscribe((events) => listener(landedFacts(events)), scope),

		// --- schedules and scores ---
		onScheduleMissed: scheduleNotices.onMissed,
		onSchedulesChanged: scheduleNotices.onChanged,
		async scoreOpenPullRequests() {
			await ready;
			await pullRequestWatch.score();
		},
		async webhook(request) {
			await ready;
			return schedules.receiveWebhook(request);
		},

		// --- views (R2) ---
		async runHere(runId) {
			await ready;
			return views.cases.readRunHere({ runId });
		},
		async runTrace(runId) {
			await ready;
			return views.cases.readRunTrace({ runId });
		},

		// --- recovery (R7) ---
		async deviceBack(_deviceId) {
			await ready;
			await parts.wakeOfflineSleeps();
		},

		// --- the run use cases: each waits for the engine to be ready ---
		runs: whenReady(ready, { ...parts.runs, ...views.runs }),

		// --- the Gate use cases (R6): each waits for the engine to be ready ---
		gates: whenReady(ready, parts.gates),

		// --- answer costs (AC): the exchange did not wait for ready, and does not ---
		answerCosts: parts.answerCosts.shared,

		// --- the dashboard (DB): through the Space view, which waits for ready ---
		dashboard: parts.dashboard,

		// --- the end of the engine ---
		async dispose() {
			lifetime.abort();
			landed.close();
			await runner.release();
		},
	};
}

/**
 * Each use case of `cases`, waiting for the engine to be ready first. A
 * use case that returns a stream opens it after that, as it does now.
 */
function whenReady<T extends Record<string, (...args: never[]) => unknown>>(
	ready: Promise<unknown>,
	cases: T,
): T {
	return Object.fromEntries(
		Object.entries(cases).map(([name, useCase]) => [
			name,
			async (...args: never[]) => {
				await ready;
				return useCase(...args);
			},
		]),
	) as T;
}
