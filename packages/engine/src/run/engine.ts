import { harnessFacts } from "@nightshift/agents/harness-facts";
import { isCustomHarness, type Schedule } from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";
import { createArtifactStore } from "../artifacts";
import { createRunCopies, startCleanupJob } from "../cleanup";
import type { Actor, LeaseHost, MemberChange } from "../contract";
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
	createRecorders,
	createRunner,
	createRunWalks,
	kindOf,
	type StepShared,
} from "../graph";
import {
	createLeaseKeeper,
	createLeaseStore,
	leaseHolds,
	leasesLost,
	trackHeldLeases,
} from "../leases";
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
	type RunLog,
	runIdsOfProject,
	spaceOfRun,
} from "../log";
import { createPlacement } from "../placement";
import {
	createProjects,
	createRunBranches,
	createSpaceDocuments,
	createWorktrees,
	forgetSpaceRows,
	memberName,
	spaceUsageOn,
	systemGit,
} from "../projects";
import {
	createReadModel,
	gitAuthorOf,
	type LandedFact,
	landedFacts,
	namesOf,
	parseCalledFlows,
	parseRunFlow,
	type RunHere,
	type RunTrace,
} from "../read";
import {
	createPullRequestScores,
	createPullRequestWatch,
	createScheduleFiles,
	createScheduler,
	createWebhooks,
	DEFAULT_SCHEDULE_TICK_MS,
	type ScheduleMissed,
	type WebhookAnswer,
	type WebhookRequest,
} from "../schedules";
import { createServiceKeeper, serviceHolds } from "../services";
import { keptValues, listKeptValues, resetKeptValue } from "../variables";
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
 *   for a person's, a schedule's and a webhook's start, and the start
 *   itself: here, or handed to the Host.
 * - `placement/`: where each step runs. The plan a run starts with
 *   (`planNodes`), the one fit check, and the walk's reader of the plan
 *   (`createPlacement`): the Device of a step now, and its move when that
 *   Device is offline (ADR 17).
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
 * - `peers` (`EngineOptions.peers`, the port in `peers.ts`): who a run's
 *   Devices are, Offers, the Host that keeps a Space and the runs walked
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
}

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
	const now = internals.now ?? timeNow;
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
		createRunLog(db, {
			walkerId: options.walkerId || directory.selfId,
			dataDir,
		});
	const documents =
		options.spaceDocuments ?? createSpaceDocuments({ db, directory });
	const flowDocuments = options.flowDocuments ?? createFlowDocuments({ db });

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
	const walks = createRunWalks({ db, log: runLog, history });

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
			setClones: (spaceId, input) => projects.setClones(spaceId, input),
			clonedHere: (spaceId) => projects.clonedHere(spaceId),
			forgetDevice: (deviceId) => projects.forgetDevice(deviceId),
			addFromRemote: (spaceId, input) => projects.addFromRemote(spaceId, input),
			defineWithoutFolder: (spaceId, input) =>
				projects.defineWithoutFolder(spaceId, input),
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
			// The Offer the run's step ran under ended: Night Shift stops it, not a person.
			stop: async (runId) => {
				await runner.take(runId, { kind: "stop", by: "daemon" });
			},
		},
		async logFact(fact, writes) {
			await runLog.append(fact, writes);
		},
	});
	const { placement: devices, relay: hosts } = peers;
	/** Where each run's steps run, as its plan says (`placement/`). */
	const placement = createPlacement({ device, devices });

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
	/** What brings a flow or a schedule of an older format to the current one: its nodes name a Device's profile, and their Device, by id. */
	const thisDevice = async () => ({
		id: await runLog.walkerId(),
		name: device.name,
	});
	const migrations = createFlowMigrations({
		db,
		device: thisDevice,
		profiles: options.profiles,
		directory,
		spaces: documents,
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
		onLost: (runId, names) => leasesLost({ log: runLog }, runId, names),
	});
	leases.start(signal);
	/** The services of the runs this computer walks (ADR 9). */
	const services = createServiceKeeper({
		now,
		...(internals.secondMs !== undefined
			? { secondMs: internals.secondMs }
			: {}),
	});
	/** What runs hold for a scope: the engine lets go of it when a run ends. */
	const runHolds = combineHolds([
		leaseHolds({ keeper: leases, log: runLog }),
		serviceHolds({
			keeper: services,
			log: runLog,
			deviceOf: async (runId, deviceId) =>
				placement.deviceById(deviceId, await getRunRow(db, runId)),
		}),
	]);

	/** The files runs keep for the person: an agent's artifacts, the answers' files. */
	const artifacts = createArtifactStore(dataDir);
	/** What a step may touch on this computer, the same for every run. */
	const shared: StepShared = {
		log: runLog,
		bus,
		recorders: createRecorders({ db, bus, log: runLog }),
		placement,
		now,
		minuteMs,
		settings: runSettings,
		kindOf,
		leases,
		services,
		artifacts,
		keptValues: (flow) => keptValues(db, flow),
		gitAuthor: (personId) => gitAuthorOf(db, personId),
		...(options.usage ? { usage: options.usage } : {}),
	};
	const runner = createRunner({
		shared,
		db,
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		signal,
		holds: runHolds,
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
		placedElsewhere: (row) => !placement.placedHere(row),
		resumeGraceMs: internals.resumeGraceMs ?? DAEMON_RESUME_GRACE_MS,
		signal,
		holds: startHolds,
		runHolds,
	});

	// The leases the runs here held when the last daemon stopped are renewed
	// from now on: before recovery, which lets go of those of the runs that
	// do not continue.
	const recovered = trackHeldLeases({ db, log: runLog, keeper: leases })
		.catch((error) => {
			console.warn("[engine] could not read the leases of the runs", error);
		})
		.then(() => recovery.recoverInterruptedWork());
	const ready = recovered
		// Those leases are renewed at once, not a minute from now: the last
		// daemon renewed them up to a minute before it stopped, and a lease of
		// 2 minutes would expire first. After recovery, so a run it ended
		// interrupted takes back a lease it lost when it continues. The start
		// does not wait for a Host that answers late. A Host whose link is not
		// up yet gets the renewal when it is (`hostBack`).
		.then(() => {
			void leases.renewAll();
		})
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

	/**
	 * Brings the flows of format 6 of every Project whose Space this
	 * Replica keeps to the current format, once (ADR 3). A failure is
	 * logged, and the next start tries again; reads migrate meanwhile.
	 */
	async function upgradeKeptFlows(): Promise<void> {
		try {
			await projectFlows.upgrade(
				async (spaceId) => !(await directory.hostedElsewhere(spaceId)),
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
		plan: async (input) =>
			devices.plan({
				...input,
				lastRun: await lastRunDevice(db, input.project.id),
			}),
		selfName: device.name,
		memberName: membersName,
	});

	const relay = createRunRelay({
		db,
		log: runLog,
		...(hosts ? { relay: hosts } : {}),
		now,
		listRuns: reads.listRuns,
	});

	/** Who walks a run and its Run's Device, and the start itself, for every start (`start-place.ts`). */
	const places = createStartPlaces({
		ready,
		hostedElsewhere: (spaceId) => directory.hostedElsewhere(spaceId),
		hostReachable: async (spaceId) =>
			hosts ? hosts.reachable(spaceId) : false,
		hostOf: (spaceId) => directory.hostOf(spaceId),
		walkerId: () => runLog.walkerId(),
		placements: devices.placements,
		lastRunDevice: (projectId) => lastRunDevice(db, projectId),
		spaceOf: async (projectId) => (await projects.find(projectId)).spaceId,
		startOnHost: (input, spaceId) => relay.startOnHost(input, spaceId),
		startHere: (spaceId, input, trigger) =>
			startHolds.start(spaceId, () => runStart.start(input, trigger)),
	});

	// The Replica that keeps the Space fires every schedule of it (its Host,
	// or the one Device of a Space without one), so one that is always on
	// starts them, and its runs run there (ADR 15). A webhook schedule's
	// webhooks go to the same Replica.
	const firesHere = async (projectId: string, _schedule: Schedule) => {
		const row = await projects.find(projectId);
		return !(await directory.hostedElsewhere(row.spaceId));
	};

	const missedListeners = new Set<(missed: ScheduleMissed) => void>();
	const scheduler = createScheduler({
		db,
		now,
		tickMs: internals.scheduleTickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		startRun: places.startForSchedule,
		log: runLog,
		// Also a project without a Clone here: its runs run on another Device.
		projects: () => projects.listInSpace(),
		flows: projectFlows,
		enabled: () => runSettings().scheduler,
		firesHere,
		runStatus: reads.runStatus,
		usage: options.usage,
		missed: (time) => {
			void projects
				.find(time.projectId)
				.then(({ spaceId }) => {
					for (const listener of [...missedListeners]) {
						listener({ ...time, spaceId });
					}
				})
				.catch((error) =>
					console.error("[schedules] could not tell of a missed time", error),
				);
		},
	});
	const pullRequestWatch = createPullRequestWatch({
		db,
		log: runLog,
		now,
		usage: options.usage,
		github: options.github ?? { viewPullRequest: async () => null },
	});
	if (options.scheduler !== false) {
		const schedulerSignal = options.scheduler?.signal;
		signal.addEventListener("abort", () => scheduler.stop(), { once: true });
		ready.then(
			() => {
				if (disposed) return;
				scheduler.start(schedulerSignal);
				if (options.github) pullRequestWatch.everyMorning(signal);
			},
			() => {},
		);
	}

	/** A webhook schedule's signal: the project's runs this computer walks that wait for it. */
	const signals = createSignals({ db, log: runLog, runner });

	/** A webhook schedule's pull request scores: the project's runs this computer walks. */
	const pullRequestScores = createPullRequestScores({
		db,
		log: runLog,
		now,
		usage: options.usage,
	});

	const webhooks = createWebhooks({
		db,
		now,
		log: runLog,
		flows: projectFlows,
		secret: async (name, projectId) => {
			if (!options.secret) return process.env[name];
			const { spaceId } = await projects.find(projectId);
			return options.secret(name, { spaceId, projectId });
		},
		firesHere,
		// The Settings switch, and NIGHTSHIFT_SCHEDULER=off: no schedule starts.
		enabled: () => options.scheduler !== false && runSettings().scheduler,
		startRun: places.startForSchedule,
		scorePullRequests: (projectId, webhook) =>
			pullRequestScores.take(projectId, webhook),
		signal: (projectId, signal) => signals.send(projectId, signal),
	});

	const actions = createRunActions({
		db,
		log: runLog,
		artifacts,
		bus,
		runner,
		relay,
		archive: peers.runs,
		walks,
		device,
		flowOf: parseRunFlow,
		placement: devices,
		holds: startHolds,
		leases,
		...(options.usage ? { usage: options.usage } : {}),
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
		placement: devices,
		placements: places.placements,
		flows: createSpaceFlows({
			ready,
			flows: projectFlows,
			usage: options.usage,
			project: (projectId, spaceId) => projects.find(projectId, spaceId),
			personNames: (ids) => namesOf(db, ids),
			deviceNames: (ids) => directory.names(ids),
			migration: async (scope) =>
				migrations.forDevice(await runLog.walkerId(), scope),
		}),
		importClone: (projectId) => cloneImports.project(projectId),
		kept: {
			list: (flow) => listKeptValues(db, flow),
			reset: (flow, name) => resetKeptValue(db, flow, name),
		},
		scheduleFiles: createScheduleFiles({
			now,
			flows: projectFlows,
			usage: options.usage,
			scheduler,
			webhooks,
			runStatus: reads.runStatus,
			schedulesWithOffers: peers.offers.schedulesWithOffers,
		}),
		reads,
		artifacts,
		actions,
		startRun: places.start,
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
		leases: {
			take: (take) => leaseStore.take(take),
			renew: (input) => leaseStore.renew(input),
			// A lease a Device's run lets go of here wakes the runs here that wait.
			release: async (input) => {
				await leaseStore.release(input);
				void wakeLeaseSleeps({ db, log: runLog, runner }).catch(() => {});
			},
		},
		onLandedFacts: (listener, scope) =>
			landed.subscribe((events) => listener(landedFacts(events)), scope),
		onScheduleMissed(listener) {
			missedListeners.add(listener);
			return () => missedListeners.delete(listener);
		},
		moveProjects,
		async forgetSpace(spaceId) {
			await ready;
			if (!(await forgetSpaceRows(db, spaceId))) return false;
			await documents.remove(spaceId);
			return true;
		},
		flows: projectFlows,
		async usageAllowed() {
			await ready;
			const spaces = await documents.openAll();
			return spaces.every(spaceUsageOn);
		},
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
		async hostBack() {
			// After recovery, as at the start. Not after the rest of `ready`.
			await recovered;
			await leases.renewAll();
		},
		async scoreOpenPullRequests() {
			await ready;
			await pullRequestWatch.score();
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
