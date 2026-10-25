import { harnessFacts } from "@nightshift/agents/harness-facts";
import { isCustomHarness } from "@nightshift/flows";
import { createArtifactStore } from "../artifacts";
import { createRunCopies, startCleanupJob } from "../cleanup";
import type { Actor, MemberChange, StartRunInput } from "../contract";
import { defaultRunSettings, type RunSettings } from "../device-config";
import { createFlowFiles } from "../flows";
import { createRunner, createRunWalks, resolvePolicy } from "../graph";
import {
	copyStamps,
	createRunBus,
	createRunHistory,
	createRunLog,
	getRunRow,
	type LandedRunListener,
	logMemberChange,
	onLandedRunEvents,
	planOf,
	type RunLog,
	type RunRow,
	type RunTrigger,
	runIdsOfProject,
	spaceOfRun,
} from "../log";
import {
	createProjects,
	createRunBranches,
	createSpaceDocuments,
	createWorktrees,
	systemGit,
} from "../projects";
import {
	createReadModel,
	parseCalledFlows,
	parseRunFlow,
	type RunHere,
	type RunSummary,
} from "../read";
import {
	createScheduleFiles,
	createScheduler,
	DEFAULT_SCHEDULE_TICK_MS,
} from "../schedules";
import { createRunActions } from "./actions";
import type { EngineOptions } from "./engine-options";
import { createRecovery } from "./recovery";
import { createRunRelay } from "./relay";
import { createRunStart } from "./run-start";
import { createSpaces } from "./space";
import type { SpaceEngine } from "./space-engine";
import { takeOver } from "./take-over";
import { wakeOfflineSleeps } from "./wake";

/**
 * The engine: projects, flows, schedules, Gates and runs, over the event
 * log as the read model. A run is one LangGraph thread that the runner
 * (`graph/runner.ts`) drives. `createEngine` is the composition root: it
 * makes each module with its dependencies and wires them. It holds no
 * logic of its own.
 *
 * - `run-start.ts`: `startRun` validates, checks what this daemon has,
 *   writes `RunStarted` and hands the thread to the runner.
 * - `recovery.ts`: startup recovery and the daemon's automatic resume.
 * - `space.ts`: what a person does in one Space (`SpaceEngine`, in
 *   `space-engine.ts`).
 * - `actions.ts`: the run actions (stop, answer a Gate, send a Signal,
 *   move, resume, restart a step, run again). One entry reads the run's
 *   row once, refuses by the run's one rule (`run-status/`), and takes the
 *   action here as a Turn of the runner, or hands it to the run's Walker
 *   as a command (`relay.ts`): the Walker is the only writer of its run's
 *   events. `take-over.ts` is the other end of a move. `wake.ts` wakes
 *   the runs that slept for a Device that is back.
 * - `read/read-model.ts`: the summaries, `getRun`, `listGates`, `watchRun`.
 * - `flows/`: the flow files of a project. `schedules/`: the scheduler and
 *   the schedules file.
 * - `cleanup/`: what ended runs left on this computer (worktrees and
 *   branches), their removal, and the scheduled sweep.
 * - `projects/`: projects by remote and their Clones on this computer,
 *   over the git port. A project is defined in its Space document. Its
 *   `project` row is the document's projection.
 * - `peers` (`EngineOptions.peers`, the port in `peers.ts`):
 *   placement, Offers, the Host that keeps a Space and the runs walked
 *   elsewhere. `@nightshift/devices` implements it over its Links.
 *
 * Spaces: `createEngine` returns the Device's engine. `space(id)` is what
 * a person does in one Space. The walk, recovery and the scheduler run
 * across every Space on this Device. Each row they write takes the Space
 * of its project (`run-start`, `events`).
 */

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_MAX_STEPS_PER_RUN = 500;
/** How long a new daemon waits before it resumes the runs the last one stopped mid-step. */
const DAEMON_RESUME_GRACE_MS = 5_000;

/**
 * The engine of this Device. Its background work (the walk, recovery, the
 * scheduler) covers every Space the Device holds, and writes each row with
 * its own Space. What a person does goes through one Space's view.
 */
export interface Engine {
	/**
	 * What a person does in one Space. Nothing it reads, returns or changes
	 * is of another Space: a project or run of another Space is "not found".
	 * `actor` is the Person who acts: an action on a run walked elsewhere
	 * travels to its Walker in their name.
	 */
	space(spaceId: string, actor?: Actor): SpaceEngine;
	/**
	 * The Space of a run this computer keeps, or null when it has none of
	 * that id. Who may see or act on the run there is the caller's check:
	 * then it goes through that Space's view.
	 */
	spaceOfRun(runId: string): Promise<string | null>;
	/**
	 * Logs a change of a Space's Members in that Space's event log
	 * (`MemberJoined`, `MemberRemoved`, `MemberRoleChanged`), with who made it.
	 */
	logMemberChange(change: MemberChange): Promise<void>;
	/**
	 * Calls `listener` with the run events that land in this Replica from
	 * now on: appended here, or brought by the exchange from another
	 * Walker. Each carries its run's Space. The notifier reads Gates and
	 * run endings from it. Returns the unsubscribe.
	 */
	onRunEvents(listener: LandedRunListener): () => void;
	/**
	 * A run's status, when it wakes, and whether this computer walks it or
	 * runs its steps, in any Space of this Replica. Null for a run it does
	 * not have. Cheap: one row and the facts the run log keeps, for a
	 * reader that asks on every landed event (keep this computer awake).
	 */
	runHere(runId: string): Promise<RunHere | null>;
	/**
	 * A Device is back (its link to this Host took work again): the steps
	 * of the runs this computer walks that sleep because a Device was
	 * offline look again now, instead of at their next try.
	 */
	deviceBack(deviceId: string): Promise<void>;
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
}

/** Knobs for tests only. Not part of the engine contract. */
export type EngineInternals = {
	/** How long one minute of a node's `timeoutMinutes`, `idleMinutes` or a policy wait lasts. Default 60 000 ms. */
	minuteMs?: number;
	/** The clock for waits and the stop time. Default `Date.now`. */
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
	/** How long after the engine is ready the cleanup of run copies first sweeps. Default 60 000 ms. */
	cleanupDelayMs?: number;
	/** How often the cleanup of run copies sweeps. Default 6 h. */
	cleanupEveryMs?: number;
};

export function createEngine(
	options: EngineOptions,
	internals: EngineInternals = {},
): Engine {
	const minuteMs = internals.minuteMs ?? 60_000;
	const now = internals.now ?? Date.now;
	const { db, dataDir, device, directory } = options;
	const maxConcurrentRuns =
		options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
	if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
		throw new Error("maxConcurrentRuns must be a positive integer.");
	}
	const maxStepsPerRun = options.maxStepsPerRun ?? DEFAULT_MAX_STEPS_PER_RUN;
	if (!Number.isInteger(maxStepsPerRun) || maxStepsPerRun < 1) {
		throw new Error("maxStepsPerRun must be a positive integer.");
	}
	/** The daemon's settings, read when they apply. Without a store: the options, then the defaults. */
	const runSettings = (): RunSettings =>
		options.settings?.() ?? {
			...defaultRunSettings(),
			maxConcurrentRuns,
			maxStepsPerRun,
		};
	const bus = createRunBus();
	const runLog =
		internals.runLog ??
		createRunLog(db, { walkerId: options.walkerId || directory.selfId });
	const documents =
		options.spaceDocuments ?? createSpaceDocuments({ db, directory });

	/** Whether a run's own worktree is on this computer, as its plan says. */
	const placedHere = (row: RunRow) => {
		const at = planOf(row).device.id;
		return at === device.id || at === row.walkerId;
	};

	/** The Person who owns this computer (`directory.selfOwnerId`), read when the engine is ready. */
	let ownerId: string | null = null;

	/** `ready` (below), for the peers made before it: it settles as `ready` does. */
	let settleReady: [() => void, (error: unknown) => void] = [
		() => {},
		() => {},
	];
	const peersReady = new Promise<void>((resolve, reject) => {
		settleReady = [resolve, reject];
	});
	peersReady.catch(() => {});

	const history = createRunHistory({ db, dataDir, log: runLog, bus });
	/** The walk state of the runs this computer walks, as files (`graph/walk-state.ts`). */
	const walks = createRunWalks({ db, dataDir, log: runLog, history });

	/**
	 * The other Devices and Hosts (`Peers`): where steps run, Offers, the
	 * Host that keeps a Space, and the runs walked elsewhere.
	 */
	const peers = options.peers({
		db,
		dataDir,
		device,
		log: runLog,
		bus,
		history,
		walks: { exportWalk: walks.exportWalk, ownFile: walks.ownFile },
		documents,
		now,
		...(options.profileFor ? { profileFor: options.profileFor } : {}),
		ready: peersReady,
		ownerId: () => ownerId,
		// Every open step's reader asks on each change of the run: the run
		// log derives the stamps once per append for all of them.
		stepStamp: async ({ runId, stepId }) =>
			(await runLog.derive([runId], copyStamps)).get(runId)?.get(stepId) ??
			null,
		project: (projectId, spaceId) => projects.find(projectId, spaceId),
		takeOver: (runId) =>
			takeOver({ db, log: runLog, runner, archive: peers.runs, walks }, runId),
		stopRun: async (runId) => {
			await runner.take(runId, { kind: "stop" });
		},
	});
	const { placement, relay: hosts } = peers;

	const git = options.git ?? systemGit();
	const { listBranches } = createWorktrees(git);
	const projects = createProjects({
		db,
		log: runLog,
		deviceId: runLog.walkerId,
		documents,
		directory,
		git,
		...(hosts ? { relay: hosts } : {}),
	});
	// The engine's lifetime: a test's signal, or `dispose` (a `bun --hot`
	// handover) ends it.
	const lifetime = new AbortController();
	internals.signal?.addEventListener("abort", () => lifetime.abort(), {
		once: true,
	});
	const signal = lifetime.signal;
	let disposed = false;
	signal.addEventListener(
		"abort",
		() => {
			disposed = true;
		},
		{ once: true },
	);

	const runner = createRunner({
		db,
		log: runLog,
		bus,
		dataDir,
		now,
		minuteMs,
		settings: runSettings,
		deviceFor: placement.deviceFor,
		deviceById: placement.deviceById,
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		policyFor: (flow) => resolvePolicy(flow.policy, runSettings().policy),
		signal,
		...(internals.overdueSweepMs !== undefined
			? { overdueSweepMs: internals.overdueSweepMs }
			: {}),
	});

	const recovery = createRecovery({
		db,
		log: runLog,
		bus,
		runner,
		now,
		settings: runSettings,
		schedulerOn: options.scheduler !== false,
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		placedElsewhere: (row) => !placedHere(row),
		resumeGraceMs: internals.resumeGraceMs ?? DAEMON_RESUME_GRACE_MS,
		signal,
	});

	const ready = recovery
		.recoverInterruptedWork()
		// Every Space's document: Projects from before it are imported once.
		.then(() => documents.openAll())
		.then(() =>
			// Projects from before Clones get their remote. A git that fails
			// leaves it for the next start.
			projects.readRemotes().catch(() => {}),
		)
		// Whose runs are this computer's own: another Person's take an Offer.
		.then(async () => {
			ownerId = await directory.selfOwnerId();
		})
		// The interrupted runs' grace counts from now: the engine is ready.
		.then(() => recovery.armResumes());
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});
	ready.then(...settleReady);

	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	const hostOf = peers.hostOf;

	const reads = createReadModel({
		db,
		log: runLog,
		bus,
		deviceId: device.id,
		// Any harness, added or not: an old run's session stays takeable.
		// A custom agent has no take-over command.
		harnessOf: (name) =>
			isCustomHarness(name) ? undefined : harnessFacts(name),
		walkers: peers.runs.walkers,
		pendingCommands: peers.runs.pendingCommands,
		stepEntries: peers.runs.stepEntries,
	});

	const runStart = createRunStart({
		db,
		log: runLog,
		runner,
		now,
		projectRow: (projectId) => projects.find(projectId),
		plan: placement.plan,
		selfName: device.name,
	});

	const scheduler = createScheduler({
		db,
		now,
		tickMs: internals.scheduleTickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		startRun: startRunWith,
		log: runLog,
		projects: projects.list,
		enabled: () => runSettings().scheduler,
		// The Device a schedule names fires it. Without one, the Replica that
		// keeps the Space (its Host, or the one Device of a Space without one).
		firesHere: async (projectId, schedule) => {
			if (schedule.device !== undefined) return schedule.device === device.name;
			const row = await projects.find(projectId);
			return (await hostOf(row.spaceId)) === null;
		},
		runStatus: reads.runStatus,
	});
	if (options.scheduler !== false) {
		const schedulerSignal = options.scheduler?.signal;
		signal.addEventListener("abort", () => scheduler.stop(), {
			once: true,
		});
		ready.then(
			() => {
				if (!disposed) scheduler.start(schedulerSignal);
			},
			() => {},
		);
	}

	async function startRunWith(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		await ready;
		return runStart.start(input, trigger);
	}

	const relay = createRunRelay({
		db,
		log: runLog,
		...(hosts ? { relay: hosts } : {}),
		now,
		listRuns: reads.listRuns,
	});

	const actions = createRunActions({
		db,
		log: runLog,
		bus,
		runner,
		relay,
		archive: peers.runs,
		walks,
		device,
		runRow: (runId) => getRunRow(db, runId),
		flowOf: parseRunFlow,
		placement,
	});

	/** What runs left on this computer: the overview, its two actions, and the scheduled cleanup. */
	const runCopies = createRunCopies({
		db,
		log: runLog,
		branches: createRunBranches(git),
		projects,
		listRuns: reads.listRuns,
		runRow: (runId) => getRunRow(db, runId),
		runStatus: reads.runStatus,
		isActive: (runId) => runner.isActive(runId),
		now,
		settings: runSettings,
	});
	startCleanupJob({
		sweep: runCopies.sweep,
		ready,
		signal,
		...(internals.cleanupDelayMs !== undefined
			? { delayMs: internals.cleanupDelayMs }
			: {}),
		...(internals.cleanupEveryMs !== undefined
			? { everyMs: internals.cleanupEveryMs }
			: {}),
	});

	const space = createSpaces({
		ready,
		signal,
		deviceId: device.id,
		log: runLog,
		runner,
		projects,
		documents,
		runIdsOfProject: (projectId) => runIdsOfProject(db, projectId),
		runRow: (runId) => getRunRow(db, runId),
		listBranches,
		runCopies,
		placement,
		flowFiles: createFlowFiles({
			find: projects.find,
			get: projects.get,
			elsewhere: placement.flowsElsewhere,
		}),
		scheduleFiles: createScheduleFiles({
			now,
			scheduler,
			runStatus: reads.runStatus,
			schedulesWithOffers: peers.offers.schedulesWithOffers,
		}),
		reads,
		artifacts: createArtifactStore(dataDir),
		actions,
		relay,
		hostOf,
		startRun: startRunWith,
		pathsFor: peers.pathsFor,
	});

	return {
		space,
		async spaceOfRun(runId) {
			await ready;
			return spaceOfRun(db, runId);
		},
		logMemberChange: (change) => logMemberChange(runLog, change),
		onRunEvents: (listener) => onLandedRunEvents(db, runLog, listener),
		async runHere(runId) {
			await ready;
			return reads.runHere(runId);
		},
		async deviceBack(_deviceId) {
			await ready;
			await wakeOfflineSleeps({ db, log: runLog, runner });
		},
		async dispose() {
			lifetime.abort();
			await runner.release();
		},
	};
}
