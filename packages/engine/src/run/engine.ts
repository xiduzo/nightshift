import { harnessFacts } from "@nightshift/agents/harness-facts";
import { isCustomHarness } from "@nightshift/flows";
import type { Engine, EngineOptions, StartRunInput } from "../contract";
import {
	defaultRunSettings,
	type RunSettings,
	selfOwnerId,
} from "../device-config";
import { createFlowFiles } from "../flows";
import { createRunner, resolvePolicy } from "../graph";
import {
	createRunBus,
	createRunLog,
	getRunRow,
	logMemberChange,
	type RunLog,
	type RunRow,
	type RunTrigger,
	runIdsOfProject,
} from "../log";
import {
	createProjects,
	createSpaceDocuments,
	createWorktrees,
	systemGit,
} from "../projects";
import {
	createReadModel,
	parseCalledFlows,
	parseRunFlow,
	type RunSummary,
} from "../read";
import {
	createScheduleFiles,
	createScheduler,
	DEFAULT_SCHEDULE_TICK_MS,
} from "../schedules";
import { createRunControl } from "./control";
import { createRecovery } from "./recovery";
import { createRunRelay } from "./relay";
import { createRunStart } from "./run-start";
import { createSpaces } from "./space";

/**
 * The engine: projects, flows, schedules, Gates and runs, over the event
 * log as the read model. A run is one LangGraph thread that the runner
 * (`graph/runner.ts`) drives. `createEngine` is the composition root: it
 * makes each module with its dependencies and wires them. It holds no
 * logic of its own.
 *
 * - `run-start.ts`: `startRun` validates, checks what this daemon has,
 *   writes `RunStarted` and hands the thread to the runner.
 * - `recovery.ts`: startup recovery, the daemon's automatic resume,
 *   `resumeRun`, `restartStep` and `rerunFrom` (each appends `RunResumed`
 *   before the thread moves).
 * - `space.ts`: what a person does in one Space (`SpaceEngine`).
 * - `stop.ts`, `move.ts`, `gate.ts`, `wake.ts`: the actions that write one
 *   run-level fact each. On a run another Device walks they write
 *   nothing: the Walker is the only writer of its run's events, so the
 *   action travels to it as a command (`relay.ts`), and the Walker
 *   applies it. Every other action on such a run is refused.
 * - `read/read-model.ts`: the summaries, `getRun`, `listGates`, `watchRun`.
 * - `flows/`: the flow files of a project. `schedules/`: the scheduler and
 *   the schedules file.
 * - `projects/`: projects by remote and their Clones on this computer,
 *   over the git port. A project is defined in its Space document. Its
 *   `project` row is the document's projection.
 * - `peers` (`EngineOptions.peers`, the port in `contract/peers.ts`):
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
};

export function createEngine(
	options: EngineOptions,
	internals: EngineInternals = {},
): Engine {
	const minuteMs = internals.minuteMs ?? 60_000;
	const now = internals.now ?? Date.now;
	const { db, dataDir, device } = options;
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
		createRunLog(db, options.walkerId ? { walkerId: options.walkerId } : {});
	const documents = options.spaceDocuments ?? createSpaceDocuments({ db });

	/** Whether a run's own worktree is on this computer: placed here, or before Placement. */
	const placedHere = (row: RunRow) =>
		row.deviceId === null ||
		row.deviceId === device.id ||
		row.deviceId === row.walkerId;

	/** The Person who owns this computer (its `device` row), read when the engine is ready. */
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
		documents,
		now,
		...(options.relay ? { relay: options.relay } : {}),
		...(options.profileFor ? { profileFor: options.profileFor } : {}),
		ready: peersReady,
		ownerId: () => ownerId,
		project: (projectId, spaceId) => projects.find(projectId, spaceId),
		takeOver: (runId) => control.takeOver(runId),
		stopRun: (runId) => runner.stop(runId),
	});
	const { placement } = peers;

	const git = options.git ?? systemGit();
	const { listBranches } = createWorktrees(git);
	const projects = createProjects({
		db,
		log: runLog,
		deviceId: runLog.walkerId,
		documents,
		git,
		...(options.relay ? { relay: options.relay } : {}),
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
		// `recovery` is assigned below; the runner frees its first slot later.
		onSlotFreed: () => recovery.onSlotFreed(),
	});

	const recovery = createRecovery({
		db,
		log: runLog,
		runner,
		now,
		settings: runSettings,
		schedulerOn: options.scheduler !== false,
		flowOf: parseRunFlow,
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
		// The names of the Devices runs may be placed on, for their messages.
		.then(() => placement.loadNames())
		// Whose runs are this computer's own: another Person's take an Offer.
		.then(async () => {
			ownerId = await selfOwnerId(db);
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
		isActive: runner.isActive,
		// Any harness, added or not: an old run's session stays takeable.
		// A custom agent has no take-over command.
		harnessOf: (name) =>
			isCustomHarness(name) ? undefined : harnessFacts(name),
		walkers: peers.runs.walkers,
		pendingCommands: peers.runs.pendingCommands,
		stepTranscript: peers.runs.stepTranscript,
		followStep: peers.runs.followStep,
	});

	const runStart = createRunStart({
		db,
		log: runLog,
		runner,
		now,
		projectRow: (projectId) => projects.find(projectId),
		profileFor: options.profileFor ?? (() => null),
		place: placement.place,
		selfName: device.name,
		personOnHost: peers.personOnHost,
		offerRefusal: peers.offers.refusal,
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
		...(options.relay ? { relay: options.relay } : {}),
		now,
		listRuns: reads.listRuns,
	});

	const control = createRunControl({
		db,
		log: runLog,
		bus,
		runner,
		reads,
		relay,
		archive: peers.runs,
		pendingCommands: peers.runs.pendingCommands,
		device,
		ownDevices: placement.ownDevices,
		personOnHost: peers.personOnHost,
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
		recovery,
		relay,
		hostOf,
		startRun: startRunWith,
		pathsFor: peers.pathsFor,
		control,
	});

	return {
		space,
		logMemberChange: (change) => logMemberChange(runLog, change),
		async deviceBack(_deviceId) {
			await ready;
			await control.wakeOfflineSleeps();
		},
		async endOverdueSteps() {
			await ready;
			await runner.endOverdueSteps();
		},
		async dispose() {
			lifetime.abort();
			await runner.release();
		},
	};
}
