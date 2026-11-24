import { now as timeNow } from "@nightshift/time";
import {
	createFlowDocuments,
	createSpaceDocuments,
	memberName,
} from "./documents";
import { type Engine, type EngineInternals, engineOf } from "./engine";
import type { EngineOptions } from "./engine-options";
import { createPlacement, createRunWalks } from "./graph";
import { trackHeldLeases } from "./leases";
import {
	createLandedFeed,
	createRunBus,
	createRunHistory,
	createRunLog,
} from "./log";
import { createRunFolders } from "./run-folders";
import { takenOverSecrets } from "./secrets";
import { defaultRunSettings, type RunSettings } from "./settings";
import { createSpaces } from "./space";
import { wireEngineAccess } from "./wire-access";
import { wireEngineActions } from "./wire-actions";
import { wireEngineAnswerCosts } from "./wire-answer-costs";
import { wireEngineCleanup } from "./wire-cleanup";
import { wireEngineDashboard } from "./wire-dashboard";
import { wireEngineFlows, wireEngineSpaceFlows } from "./wire-flows";
import { wireEngineGates } from "./wire-gates";
import { wireEngineHolds } from "./wire-holds";
import { wireEngineMove } from "./wire-move";
import { wireEnginePeers } from "./wire-peers";
import { wireEngineProjects } from "./wire-projects";
import { wireEngineRecovery } from "./wire-recovery";
import { wireEngineRunner } from "./wire-runner";
import { wireEngineSchedules } from "./wire-schedules";
import { wireEngineSpaceMove } from "./wire-space-move";
import { wireEngineStart } from "./wire-start";
import { wireEngineViews } from "./wire-views";
import { wireEngineWalk } from "./wire-walk";

/**
 * The composition of the engine: `createEngine` makes each piece with what
 * it needs and wires them. It holds no logic of its own. The engine is
 * projects, flows, schedules, Gates and runs, over the event log as the
 * read model. A run is one LangGraph thread that the runner
 * (`graph/runner/runner.ts`) drives.
 *
 * `createEngine` is cut in blocks, in the order the pieces are made. A
 * block that a lane of the hexagon series owns says so in its header, and
 * the pieces of the run path each have a file beside this one. A lane
 * changes its own file and its own block here, and keeps the names the
 * other blocks read ("gives").
 *
 * - `wire-peers.ts`: the other Devices and Hosts (`Peers`).
 * - `wire-projects.ts`: the git port, and the projects with their Clones.
 * - `wire-flows.ts`: the flows of the projects and the flow upgrades.
 * - `wire-holds.ts`: the leases, the services, and what a run holds.
 * - `wire-runner.ts`: what a step may touch, and the runner.
 * - `wire-access.ts`, `wire-walk.ts` (R1): who may see or act on a run,
 *   and what every use case that writes to a run shares (`runs/`).
 * - `wire-recovery.ts` (R7): startup recovery, the daemon's resume, the
 *   wakes, the Signal of a webhook, the stop of a run by Night Shift.
 * - `wire-views.ts` (R2): what people see of the runs (`runs/views/`).
 * - `wire-start.ts` (R3): who walks a new run and its Run's Device, and the
 *   start itself: here, or handed to the Host (`runs/start/`).
 * - `wire-schedules.ts`: the schedules slice (`schedules/`), what it tells
 *   and who listens, and the pull request scores.
 * - `wire-actions.ts` (R4): what a person does to a run (`runs/actions/`).
 *   The action is taken here as a Turn of the runner, or handed to the
 *   run's Walker as a Command: the Walker is the only writer of its run's
 *   events.
 * - `wire-move.ts` (R5): the move of a run's walk to another Device, and
 *   its other end, where the new Walker takes the run over (`runs/move/`).
 * - `wire-gates.ts` (R6): the answer to a Gate and the inbox (`gates/`).
 * - `wire-cleanup.ts`: what ended runs left on this computer (`cleanup/`).
 * - `wire-space-move.ts` (SM): Projects that go to other Spaces, as one
 *   operation (`space-move/`).
 * - `space.ts`: what a person does in one Space (`SpaceEngine`, in
 *   `space-engine.ts`).
 * - `engine.ts`: the `Engine` interface and the thin object behind it.
 *
 * What the blocks stand on:
 *
 * - `placement/`: where each step runs, the plan a run starts with
 *   (`planNodes`). `graph/` holds the one fit check and the walk's reader
 *   of the plan (`createPlacement`): the Device of a step now, and its
 *   move when that Device is offline (ADR 17).
 * - `flows/`: the flows and schedules of the projects in their flow
 *   documents (`ProjectFlows`), what a person does with them in a Space
 *   (`SpaceFlows`, `SpaceEngine.flows`), and the import of a Clone's
 *   folder from before it.
 * - `cleanup/`: what ended runs left on this computer (worktrees and
 *   branches, the files of run folders), their removal, and the
 *   scheduled sweep.
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
 * of its project.
 */

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_MAX_STEPS_PER_RUN = 500;
/** How long a new daemon waits before it resumes the runs the last one stopped mid-step. */
const DAEMON_RESUME_GRACE_MS = 5_000;

export function createEngine(
	options: EngineOptions,
	internals: EngineInternals = {},
): Engine {
	// --- ground: the knobs, the settings, the run log, the documents ---
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

	// --- the log's feeds, the walk files, the run folders (mechanisms) ---
	/** Every run event as it lands here, appended or ingested. */
	const landed = createLandedFeed({ db, log: runLog });
	const history = createRunHistory({ db, dataDir, log: runLog, bus, landed });
	/** The walk state of the runs this computer walks, as files (`graph/checkpoints/walk-state.ts`). */
	const walks = createRunWalks({ db, log: runLog, history });

	/** The run folders on this computer: where runs of projects without a folder work (ADR 22). */
	const runFolders = createRunFolders(dataDir);

	// --- peers: the other Devices and Hosts: `wire-peers.ts` ---
	// Its two run calls are the blocks' own: `move.arrive` (R5) and
	// `recovery.stopForNightShift` (R7). The pieces they call are made below.
	const peers = wireEnginePeers({
		db,
		log: runLog,
		options,
		device,
		ownerId: () => ownerId,
		ready: peersReady,
		now,
		documents,
		history,
		landed,
		walks,
		runFolders,
		projects: () => projects,
		cloneRows: () => cloneRows,
		flows: (projectId) => projectFlows.flows(projectId),
		takeOver: (runId) => move.arrive(runId),
		stop: async (runId) => recovery.stopForNightShift(runId),
	});
	const { placement: devices, relay: hosts } = peers;
	/** Where each run's steps run, as its plan says (`placement/`). */
	const placement = createPlacement({ device, devices, takenOverSecrets });

	// --- access (R1): `wire-access.ts` ---
	// Before projects/flows so catalog and editing can openSpace (E-doors).
	const access = wireEngineAccess({ db, log: runLog, documents });

	// --- projects (phase 3): `wire-projects.ts` ---
	const { git, projects, catalog, cloneRows, spaces } = wireEngineProjects({
		db,
		log: runLog,
		documents,
		directory,
		hosts,
		options,
		access,
		startHolds: () => startHolds,
		runner: () => runner,
	});

	// --- flows (phase 3): `wire-flows.ts` ---
	const { projectFlows, transfer } = wireEngineFlows({
		log: runLog,
		flowDocuments,
		projects,
		ready: () => ready,
		options,
		now,
		access,
	});

	// --- the lifetime of the engine ---
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

	// --- leases, services, what a run holds (mechanisms): `wire-holds.ts` ---
	// The wake of a freed lease is the recovery block's (R7).
	const { leaseStore, leases, services, runHolds } = wireEngineHolds({
		db,
		log: runLog,
		now,
		minuteMs,
		secondMs: internals.secondMs,
		directory,
		relay: hosts?.leases,
		placement,
		onFreed: () => recovery.wakeLeaseSleeps(),
		signal,
	});

	// --- the walk: what a step may touch, the runner (graph): `wire-runner.ts` ---
	const { artifacts, runner } = wireEngineRunner({
		db,
		dataDir,
		log: runLog,
		bus,
		placement,
		now,
		minuteMs,
		settings: runSettings,
		leases,
		services,
		flows: projectFlows,
		usage: options.usage,
		signal,
		holds: runHolds,
		overdueSweepMs: internals.overdueSweepMs,
	});

	// --- walk (R1): `wire-walk.ts` ---
	// Access was wired before projects (E-doors). startHolds, walk (R4 to R7)
	const walk = wireEngineWalk({ log: runLog, bus, runner, peers });
	const startHolds = walk.holds;

	// --- recovery (R7): `wire-recovery.ts` ---
	// gives: recovery.recoverInterruptedWork, recovery.armResumes (the start
	// order), recovery.signals (schedules), recovery.wakeLeaseSleeps (leases,
	// the engine), recovery.wakeOfflineSleeps (the engine),
	// recovery.stopForNightShift (peers)
	const recovery = wireEngineRecovery({
		db,
		log: runLog,
		bus,
		walk,
		now,
		settings: runSettings,
		schedulerOn: options.scheduler !== false,
		placedElsewhere: (row) => !placement.placedHere(row),
		resumeGraceMs: internals.resumeGraceMs ?? DAEMON_RESUME_GRACE_MS,
		signal,
		access,
		runHolds,
	});

	// --- the start order ---
	// Leases tracked, recovery, lease renewal, Space documents, remotes,
	// clone imports, the owner, the resumes. No lane changes
	// this block: R7 changes the two calls of `recovery` in its own file.
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
		// Whose runs are this computer's own: another Person's take an Offer.
		.then(async () => {
			ownerId = await directory.selfOwnerId();
		})
		// The interrupted runs' grace counts from now: the engine is ready.
		.then(() => recovery.armResumes());
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});
	ready.then(...settleReady);

	// --- the names of Members (views and start read it) ---
	/** A Person's name as the Space document's Members name them: a Device knows the Host's Persons only there. */
	const membersName = async (spaceId: string, personId: string) =>
		memberName(await documents.open(spaceId), personId);

	// --- views (R2): `wire-views.ts` ---
	// gives: views.reads (start, schedules, cleanup), views.forSpace, views.cases, views.runs
	const views = wireEngineViews({
		db,
		log: runLog,
		bus,
		device,
		peers,
		history,
		access,
		signal,
		memberName: membersName,
	});

	// --- start (R3): `wire-start.ts` ---
	// gives: start.places (schedules, the Space view), start.runs (the engine)
	const start = wireEngineStart({
		ready,
		db,
		log: runLog,
		now,
		projects,
		devices,
		...(hosts ? { hosts } : {}),
		directory,
		selfName: device.name,
		memberName: membersName,
		listRuns: views.reads.listRuns,
		access,
		walk,
	});

	// --- schedules and scores: `wire-schedules.ts` ---
	// gives: sched.schedules (the Space move, the Space view, the engine),
	// sched.notices and sched.pullRequestWatch (the engine)
	// The schedules of the projects: its watch begins here, while the engine is made.
	const sched = wireEngineSchedules({
		db,
		log: runLog,
		flows: projectFlows,
		pausedHere: options.pausedHere,
		now,
		tickMs: internals.scheduleTickMs,
		access,
		runs: {
			// start (R3)
			start: start.places.startForSchedule,
			// views (R2)
			status: views.reads.runStatus,
			// recovery (R7)
			signal: (projectId, signal) => recovery.signals.send(projectId, signal),
			// peers
			shownTo: peers.pathsFor,
		},
		projects,
		directory,
		offers: peers.offers,
		secret: options.secret,
		settings: runSettings,
		scheduler: options.scheduler,
		usage: options.usage,
		github: options.github,
		signal,
		ready,
		disposed: () => disposed,
	});

	// --- move (R5): `wire-move.ts` ---
	// gives: move.arrive (peers), move.moveRun (actions), move.moveTargets
	// (the Space view), move.runs (the engine)
	const move = wireEngineMove({ access, walk, db, peers, walks, device });

	// --- gates (R6): `wire-gates.ts` ---
	const gates = wireEngineGates({ db, access, walk, artifacts, views, now });

	// --- answer costs (AC): `wire-answer-costs.ts` ---
	const answerCosts = wireEngineAnswerCosts({ db, access });

	// --- actions (R4): `wire-actions.ts` ---
	// gives: acts.actions (the Space view), acts.runs (the engine)
	const acts = wireEngineActions({
		access,
		walk,
		answer: gates.answer,
		move: move.moveRun,
		leases,
		...(options.usage ? { usage: options.usage } : {}),
	});

	// --- cleanup (phase 3): `wire-cleanup.ts` ---
	// gives: runFiles (the Space view)
	const { runFiles } = wireEngineCleanup({
		db,
		log: runLog,
		git,
		access,
		projects,
		views,
		runner,
		folders: runFolders,
		now,
		settings: runSettings,
		ready,
		signal,
		internals,
	});

	// --- the Space move (SM): `wire-space-move.ts` ---
	// gives: spaceMove.moveProjects and forgetSpace (the engine),
	// spaceMove.moveProject (the Space view)
	const spaceMove = wireEngineSpaceMove({
		db,
		documents,
		startHolds,
		holdSchedules: () => sched.schedules.ticker.hold(),
		log: runLog,
		landed,
		flows: projectFlows,
		projects,
		runner,
		options,
		access,
	});

	// --- the flows of the Space view (F1): `wire-flows.ts` ---
	const spaceFlows = wireEngineSpaceFlows({
		db,
		ready,
		directory,
		projects,
		projectFlows,
		transfer,
		options,
		access,
	});

	// --- the Space view: `space.ts` ---
	// One group of arguments for each block. A lane changes its own group.
	const space = createSpaces({
		ready,
		signal,
		log: runLog,
		// projects, flows, kept values, node memory, answer costs (phase 3)
		catalog,
		spaces,
		flows: spaceFlows.flows,
		editing: spaceFlows.editing,
		answerCosts: answerCosts.list,
		moveProject: spaceMove.moveProject,
		// access (R1), and the files of a run that other slices keep
		openRun: access.openRun,
		runFiles,
		artifacts,
		pathsFor: peers.pathsFor,
		// views (R2)
		...views.forSpace,
		// start (R3)
		start: start.places,
		// actions (R4), move (R5), gates (R6)
		actions: acts.actions,
		moveTargets: move.moveTargets,
		gates: gates.forSpace,
		// schedules
		schedules: sched.schedules,
	});

	// --- the dashboard: `wire-dashboard.ts` ---
	const dashboard = wireEngineDashboard({ space });

	// --- the engine: `engine.ts` ---
	return engineOf({
		ready,
		recovered,
		lifetime,
		space,
		log: runLog,
		spaces,
		flows: projectFlows,
		spaceMove,
		leaseStore,
		leases,
		landed,
		runner,
		runs: { ...access.runs, ...acts.runs, ...start.runs, ...move.runs },
		gates: gates.cases,
		answerCosts,
		dashboard,
		// schedules and scores
		scheduleNotices: sched.notices,
		schedules: sched.schedules,
		pullRequestWatch: sched.pullRequestWatch,
		// views (R2)
		views,
		// recovery (R7)
		wakeLeaseSleeps: recovery.wakeLeaseSleeps,
		wakeOfflineSleeps: recovery.wakeOfflineSleeps,
	});
}
