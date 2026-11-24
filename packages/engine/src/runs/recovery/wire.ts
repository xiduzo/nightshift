import type { Access } from "../../access";
import { openWork } from "../../graph";
import { foldRun, type WaitReason } from "../../log";
import { awaitsWorktree, runWorktree } from "../../read";
import type { RunFacts, StartHolds, Turns } from "../walk";
import { resumeGrace } from "./adapters/in/resume-grace";
import {
	type DrizzleOpenWorkDeps,
	drizzleOpenWork,
} from "./adapters/out/drizzle-open-work";
import {
	type DrizzleWaitsDeps,
	drizzleWaits,
} from "./adapters/out/drizzle-waits";
import { fsWorkplaces } from "./adapters/out/fs-workplaces";
import { type CheckResumePorts, checkResume } from "./application/check-resume";
import { recoverRuns } from "./application/recover-runs";
import { resumeInterruptedRun } from "./application/resume-interrupted-run";
import { signalProjectRuns } from "./application/signal-project-runs";
import { stopRunForNightShift } from "./application/stop-run-for-night-shift";
import { wakeSleepingRuns } from "./application/wake-sleeping-runs";
import type { ProjectSignal } from "./domain/signal-match";

/**
 * The wiring of recovery: the one place that builds its real adapters
 * (the open work over the database and the run log, the folders on this
 * computer's disk, the sleeps over the run log) and its timer, and binds
 * each use case to its ports. Night Shift alone calls these use cases: the
 * engine's start order, its leases, its peers and the schedules.
 */

/** What the engine gives recovery. */
export type RecoveryDeps = {
	/** What the open work stands on: the database, the run log, the run bus, the run's flows and what runs hold. */
	openWork: DrizzleOpenWorkDeps;
	/** What the sleeps stand on: the database and the run log. */
	waits: DrizzleWaitsDeps;
	facts: Pick<RunFacts, "state">;
	turns: Turns;
	/** A resume waits while the Projects of the run's Space move. */
	holds: Pick<StartHolds, "start">;
	openRun: Access["openRun"];
	schedulerOn: CheckResumePorts["schedulerOn"];
	settings: CheckResumePorts["settings"];
	now(): number;
	placedElsewhere?: CheckResumePorts["placedElsewhere"];
	/** How long after the engine is ready the runs that recovery interrupted continue. */
	resumeGraceMs: number;
	/** Aborting it drops the grace and the resumes: the engine stops. */
	signal?: AbortSignal;
};

/** What recovery gives the engine: the use cases that only Night Shift calls. */
export type Recovery = {
	/** Startup recovery: what the last daemon left open ends, and the runs that continue are kept for the grace. */
	recoverRuns(): Promise<void>;
	/** Starts the grace of the runs that continue. The engine calls it once it is ready. */
	armResumes(): void;
	/** A webhook's signal to the runs of a project here that wait for it. Returns how many woke or queued. */
	signalProjectRuns(projectId: string, signal: ProjectSignal): Promise<number>;
	/** The runs here that sleep for `reason` look again. */
	wakeSleepingRuns(reason: WaitReason): Promise<void>;
	/** Night Shift stops a run: the Offer its step ran under ended. */
	stopRunForNightShift(runId: string): Promise<void>;
};

export function wireRecovery(deps: RecoveryDeps): Recovery {
	const { facts, turns, openRun } = deps;
	const work = drizzleOpenWork(deps.openWork);
	const waits = drizzleWaits(deps.waits);
	const check = checkResume({
		openRun,
		workplaces: fsWorkplaces(),
		schedulerOn: deps.schedulerOn,
		settings: deps.settings,
		now: deps.now,
		flowOf: deps.openWork.flowOf,
		placedElsewhere: deps.placedElsewhere,
		worktreeOf: runWorktree,
		awaitsWorktree,
	});
	const recover = recoverRuns({
		openWork: work,
		turns,
		checkResume: check,
		fold: foldRun,
		whatIsOpen: openWork,
	});
	/** Startup recovery's promise: a resume waits for it first. */
	let recovered: Promise<void> = Promise.resolve();
	const grace = resumeGrace({
		graceMs: deps.resumeGraceMs,
		signal: deps.signal,
		resume: resumeInterruptedRun({
			stopped: () => deps.signal?.aborted ?? false,
			recovered: () => recovered,
			openRun,
			holds: deps.holds,
			facts,
			turns,
			checkResume: check,
			openWork: work,
		}),
	});
	return {
		recoverRuns() {
			recovered = recover().then((runs) => grace.keep(runs));
			return recovered;
		},
		armResumes: () => grace.arm(),
		signalProjectRuns: signalProjectRuns({ waits, facts, turns }),
		wakeSleepingRuns: wakeSleepingRuns({ waits, turns }),
		stopRunForNightShift: stopRunForNightShift({ turns }),
	};
}
