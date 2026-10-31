import { harnessFacts } from "@nightshift/agents/harness-facts";
import type { KnowledgeUse } from "@nightshift/agents/tools";
import { isCustomHarness, type Schedule } from "@nightshift/flows";
import { createArtifactStore } from "../artifacts";
import { createRunCopies, startCleanupJob } from "../cleanup";
import type { Actor, MemberChange, StartRunInput } from "../contract";
import {
	defaultRunSettings,
	lastKnownProfiles,
	type RunSettings,
	storedDeviceCopy,
} from "../device-config";
import {
	createCloneImports,
	createFlowDocuments,
	createFlowMigrations,
	createProjectFlows,
	createSpaceFlows,
	type ProjectFlows,
} from "../flows";
import {
	combineHolds,
	createRunner,
	createRunWalks,
	resolvePolicy,
} from "../graph";
import { logKnowledgeUse } from "../knowledge";
import { createLeaseKeeper, createLeaseStore, leaseHolds } from "../leases";
import {
	copyStamps,
	createLandedFeed,
	createRunBus,
	createRunHistory,
	createRunLog,
	getRunRow,
	type LandedScope,
	lastRunDevice,
	logMemberChange,
	placedRun,
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
	forgetSpaceRows,
	memberName,
	systemGit,
} from "../projects";
import {
	createReadModel,
	type LandedFact,
	landedFacts,
	namesOf,
	parseCalledFlows,
	parseRunFlow,
	type RunHere,
	type RunSummary,
	type RunTrace,
} from "../read";
import {
	createPullRequestScores,
	createScheduleFiles,
	createScheduler,
	createWebhooks,
	DEFAULT_SCHEDULE_TICK_MS,
	type WebhookAnswer,
	type WebhookRequest,
} from "../schedules";
import { listKeptValues, resetKeptValue } from "../variables";
import { createRunActions } from "./actions";
import type { EngineOptions } from "./engine-options";
import {
	createProjectsMove,
	type MovedProjects,
	type ProjectsMove,
} from "./projects-move";
import { createRecovery } from "./recovery";
import { createRunRelay } from "./relay";
import { createRunStart } from "./run-start";
import { createSignals } from "./signals";
import { createSpaces } from "./space";
import type { SpaceEngine } from "./space-engine";
import { createStartHolds } from "./start-holds";
import { createStartPlaces } from "./start-place";
import { takeOver } from "./take-over";
import { wakeLeaseSleeps, wakeOfflineSleeps } from "./wake";

/**
 * The engine: projects, flows, schedules, Gates and runs, over the event
 * log as the read model. A run is one LangGraph thread that the runner
 * (`graph/runner.ts`) drives. `createEngine` is the composition root: it
 * makes each module with its dependencies and wires them. It holds no
 * logic of its own.
 *
 * - `run-start.ts`: `startRun` validates, checks what this daemon has,
 *   writes `RunStarted` and hands the thread to the runner.
 * - `start-place.ts`: who walks a new run and its Run's Device, one rule
 *   for a person's, a schedule's and a webhook's start.
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
 * - `flows/`: the flows and schedules of the projects in their flow
 *   documents (`ProjectFlows`), what a person does with them in a Space
 *   (`SpaceFlows`, `SpaceEngine.flows`), and the import of a Clone's
 *   folder from before it. `schedules/`: the scheduler and the webhooks.
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
	 * Logs that an agent searched or read a project's knowledge through
	 * the nightshift MCP server (`KnowledgeSearched`, `KnowledgeRead`), as
	 * a fact of the project with no run. An Agent step logs its own.
	 */
	logKnowledgeUse(projectId: string, use: KnowledgeUse): Promise<void>;
	/**
	 * Calls `listener` with what each run event that lands in this Replica
	 * from now on means (the landed facts): appended here, or brought by
	 * the exchange from another Walker. Each carries its Space, with no
	 * query (the landed feed). The notifier reads Gates, device waits and
	 * run endings from it. Returns the unsubscribe.
	 */
	onLandedFacts(
		listener: (facts: readonly LandedFact[]) => void,
		scope?: LandedScope,
	): () => void;
	/**
	 * Moves Projects from one Space to others, as one operation (a Space
	 * move, `projects-move.ts`): no run becomes active in `move.from` and
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
	const flowDocuments = options.flowDocuments ?? createFlowDocuments({ db });

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

	/** Every run event as it lands here, appended or ingested. */
	const landed = createLandedFeed({ db, log: runLog });
	const history = createRunHistory({ db, dataDir, log: runLog, bus, landed });
	/** The walk state of the runs this computer walks, as files (`graph/walk-state.ts`). */
	const walks = createRunWalks({ db, dataDir, log: runLog, history });

	/**
	 * The other Devices and Hosts (`Peers`): where steps run, Offers, the
	 * Host that keeps a Space, and the runs walked elsewhere.
	 */
	const peers = options.peers({
		device,
		walkerId: () => runLog.walkerId(),
		ownerId: () => ownerId,
		ready: peersReady,
		now,
		documents,
		// Made below: the Projects record a Clone through the peers' relay.
		projects: {
			find: (projectId, spaceId) => projects.find(projectId, spaceId),
			ofSpace: (spaceId) => projects.ofSpace(spaceId),
			matching: (input) => projects.matching(input),
			clones: (spaceId, projectId) => projects.clones(spaceId, projectId),
			clonePath: (projectId, spaceId) => projects.clonePath(projectId, spaceId),
			recordClone: (spaceId, record) => projects.recordClone(spaceId, record),
			take: (spaceId, taken) => projects.take(spaceId, taken),
		},
		flows: (projectId) => projectFlows.flows(projectId),
		profiles: {
			here: options.profileFor ?? (() => null),

			lastKnown: (deviceId) => lastKnownProfiles(db, deviceId),
		},
		keptDevice: (deviceId) => storedDeviceCopy(db, deviceId),
		history: {
			...history,
			onLanded: (listener, scope) =>
				landed.subscribe((events) => {
					if (landedFacts(events).some((f) => f.changes !== "spend")) {
						listener();
					}
				}, scope),
		},
		runs: {
			exportWalk: walks.exportWalk,
			ownFile: walks.ownFile,
			// Every open step's reader asks on each change of the run: the run
			// log derives the stamps once per append for all of them.
			stepStamp: async ({ runId, stepId }) =>
				(await runLog.derive([runId], copyStamps)).get(runId)?.get(stepId) ??
				null,
			takeOver: (runId) =>
				takeOver(
					{ db, log: runLog, runner, archive: peers.runs, walks },
					runId,
				),
			stop: async (runId) => {
				await runner.take(runId, { kind: "stop" });
			},
		},
		async logFact(fact, writes) {
			await runLog.append(fact, writes);
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
	/** What brings a flow of format 6 to the current one: its nodes name a Device's profile. */
	const thisDevice = async () => ({
		id: await runLog.walkerId(),
		name: device.name,
	});
	const migrations = createFlowMigrations({
		db,
		device: thisDevice,
		profiles: options.profiles,
	});
	/** The flows and schedules of every project: its flow document (ADR 2). */
	const projectFlows = createProjectFlows({
		documents: flowDocuments,
		project: (projectId) => projects.find(projectId),
		deviceId: () => runLog.walkerId(),
		now,
		migrations,
	});
	/** The import on upgrade: each Clone's `.nightshift/` folder, once. */
	const cloneImports = createCloneImports({
		db,
		documents: flowDocuments,
		git,
		device: thisDevice,
		profiles: options.profiles,
		migrations,
		now,
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

	/** The leases of the Spaces this Replica keeps, and of the runs it walks (ADR 7). */
	const leaseStore = createLeaseStore({ db, now });
	const leases = createLeaseKeeper({
		db,
		store: leaseStore,
		hostedElsewhere: (spaceId) => directory.hostedElsewhere(spaceId),
		...(hosts?.leases ? { relay: hosts.leases } : {}),
		walkerId: () => runLog.walkerId(),
		minuteMs,
		// The runs here that wait for a lease ask again.
		onFreed: () => {
			void wakeLeaseSleeps({ db, log: runLog, runner }).catch(() => {});
		},
	});
	leases.start(signal);
	/** What runs hold for a scope: the engine lets go of it when a run ends. */
	const runHolds = combineHolds([leaseHolds(leases)]);

	const runner = createRunner({
		db,
		log: runLog,
		bus,
		dataDir,
		now,
		minuteMs,
		settings: runSettings,
		deviceFor: (node, row) => placement.deviceFor(node, placedRun(row)),
		deviceById: (id, row) => placement.deviceById(id, placedRun(row)),
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		policyFor: (flow) => resolvePolicy(flow.policy, runSettings().policy),
		signal,
		holds: runHolds,
		leases,
		...(internals.overdueSweepMs !== undefined
			? { overdueSweepMs: internals.overdueSweepMs }
			: {}),
	});

	/** The Spaces whose runs do not become active while their Projects move. */
	const startHolds = createStartHolds();

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
		holds: startHolds,
		runHolds,
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
		// The flows of each Clone from before ADR 2, once: before a schedule fires.
		.then(() => cloneImports.all())
		// The flows of format 6 of the Spaces this Replica keeps, once (ADR 3).
		.then(() => upgradeKeptFlows())
		// Whose runs are this computer's own: another Person's take an Offer.
		.then(async () => {
			ownerId = await directory.selfOwnerId();
		})
		// The interrupted runs' grace counts from now: the engine is ready.
		.then(() => recovery.armResumes());
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});
	ready.then(...settleReady);

	/** Whether a Host keeps the Space, not this Replica. */
	const hostedElsewhere = (spaceId: string) =>
		directory.hostedElsewhere(spaceId);

	/**
	 * Brings the flows of format 6 of every Project whose Space this
	 * Replica keeps to the current format, once (ADR 3). A failure is
	 * logged, and the next start tries again; reads migrate meanwhile.
	 */
	async function upgradeKeptFlows(): Promise<void> {
		try {
			await projectFlows.upgrade(
				async (spaceId) => !(await hostedElsewhere(spaceId)),
			);
		} catch (error) {
			console.warn(
				"Night Shift could not bring the flows to their new format. It tries again at the next start:",
				error,
			);
		}
	}

	/** A Person's name as the Space document's Members name them: a Device knows the Host's Persons only there. */
	const membersName = async (spaceId: string, personId: string) =>
		memberName(await documents.open(spaceId), personId);
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
		memberName: membersName,
	});

	const runStart = createRunStart({
		db,
		log: runLog,
		runner,
		now,
		projectRow: (projectId) => projects.find(projectId),
		plan: placement.plan,
		selfName: device.name,
		memberName: membersName,
	});

	// The Replica that keeps the Space fires every schedule of it (its Host,
	// or the one Device of a Space without one), so one that is always on
	// starts them, with a Clone of the project or not. The Device a schedule
	// names runs the run (`deviceName`), else the default Device of a
	// person's start (`start-place.ts`). A webhook schedule's webhooks go
	// to the same Replica.
	const firesHere = async (projectId: string, _schedule: Schedule) => {
		const row = await projects.find(projectId);
		return !(await hostedElsewhere(row.spaceId));
	};

	const scheduler = createScheduler({
		db,
		now,
		tickMs: internals.scheduleTickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		startRun: startForSchedule,
		log: runLog,
		// Also a project without a Clone here: its runs run on another Device.
		projects: () => projects.listInSpace(),
		flows: projectFlows,
		enabled: () => runSettings().scheduler,
		firesHere,
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

	/** Who walks a run and its Run's Device, for every start (`start-place.ts`). */
	const places = createStartPlaces({
		hostedElsewhere,
		hostReachable: async (spaceId) =>
			hosts ? hosts.reachable(spaceId) : false,
		walkerId: () => runLog.walkerId(),
		placements: placement.placements,
		lastRunDevice: (projectId) => lastRunDevice(db, projectId),
	});

	/**
	 * Starts a run, for the Person it runs for, where its start place says:
	 * the Host that keeps the Space walks it, or this computer does, on
	 * the Run's Device the start names or the default one.
	 */
	async function startRunWith(
		input: StartRunInput,
		trigger: RunTrigger,
		personId: string | null,
	): Promise<RunSummary> {
		await ready;
		const { spaceId } = await projects.find(input.projectId);
		const place = await places.place(spaceId, input, personId);
		if (place.walker === "host") {
			return relay.startOnHost({ ...input, deviceId: place.deviceId }, spaceId);
		}
		const placed =
			place.deviceId === undefined
				? input
				: { ...input, deviceId: place.deviceId };
		return startHolds.start(spaceId, () => runStart.start(placed, trigger));
	}

	/**
	 * A schedule's or a webhook's start: for the schedule's Person, else
	 * this computer's owner, with the same default as a person's start.
	 */
	function startForSchedule(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		return startRunWith(input, trigger, input.startedBy ?? ownerId);
	}

	/** A webhook schedule's signal: the project's runs this computer walks that wait for it. */
	const signals = createSignals({ db, log: runLog, runner });

	/** A webhook schedule's pull request scores: the project's runs this computer walks. */
	const pullRequestScores = createPullRequestScores({ db, log: runLog, now });

	const webhooks = createWebhooks({
		db,
		now,
		log: runLog,
		flows: projectFlows,
		secret: options.secret ?? (async (name) => process.env[name]),
		firesHere,
		// The Settings switch, and NIGHTSHIFT_SCHEDULER=off: no schedule starts.
		enabled: () => options.scheduler !== false && runSettings().scheduler,
		startRun: startForSchedule,
		scorePullRequests: (projectId, webhook) =>
			pullRequestScores.take(projectId, webhook),
		signal: (projectId, signal) => signals.send(projectId, signal),
	});

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
		holds: startHolds,
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

	/** A Space move: Projects to other Spaces, as one operation. */
	const moveProjects = createProjectsMove({
		db,
		ready,
		holds: startHolds,
		holdSchedules: () => scheduler.hold(),
		walkerId: () => runLog.walkerId(),
		flows: projectFlows,
		documents,
		// Their rows moved under the run log, in a batch that logged nothing.
		reread: (runIds) => {
			runLog.forget(runIds);
			landed.reread();
		},
		rows: options.moveRows ?? [],
		...(options.projectsMoved ? { moved: options.projectsMoved } : {}),
	});

	const space = createSpaces({
		ready,
		signal,
		log: runLog,
		runner,
		projects,
		documents,
		runIdsOfProject: (projectId) => runIdsOfProject(db, projectId),
		runRow: (runId) => getRunRow(db, runId),
		listBranches,
		runCopies,
		placement,
		placements: places.placements,
		flows: createSpaceFlows({
			ready,
			flows: projectFlows,
			project: (projectId, spaceId) => projects.find(projectId, spaceId),
			personNames: (ids) => namesOf(db, ids),
			deviceNames: (ids) => directory.names(ids),
			migration: async () => migrations.forDevice(await runLog.walkerId()),
		}),
		importClone: (projectId) => cloneImports.project(projectId),
		kept: {
			list: (flow) => listKeptValues(db, flow),
			reset: (flow, name) => resetKeptValue(db, flow, name),
		},
		scheduleFiles: createScheduleFiles({
			now,
			flows: projectFlows,
			scheduler,
			webhooks,
			runStatus: reads.runStatus,
			schedulesWithOffers: peers.offers.schedulesWithOffers,
		}),
		reads,
		artifacts: createArtifactStore(dataDir),
		actions,
		startRun: startRunWith,
		moveProjects,
		pathsFor: peers.pathsFor,
	});

	return {
		space,
		async spaceOfRun(runId) {
			await ready;
			return spaceOfRun(db, runId);
		},
		logMemberChange: (change) => logMemberChange(runLog, change),
		logKnowledgeUse: (projectId, use) =>
			logKnowledgeUse(runLog, projectId, use),
		onLandedFacts: (listener, scope) =>
			landed.subscribe((events) => listener(landedFacts(events)), scope),
		moveProjects,
		async forgetSpace(spaceId) {
			await ready;
			if (!(await forgetSpaceRows(db, spaceId))) return false;
			await documents.remove(spaceId);
			return true;
		},
		flows: projectFlows,
		async runHere(runId) {
			await ready;
			return reads.runHere(runId);
		},
		async runTrace(runId) {
			await ready;
			return reads.trace(runId);
		},
		async deviceBack(_deviceId) {
			await ready;
			await wakeOfflineSleeps({ db, log: runLog, runner });
		},
		async webhook(request) {
			await ready;
			return webhooks.receive(request);
		},
		async dispose() {
			lifetime.abort();
			landed.close();
			await runner.release();
		},
	};
}
