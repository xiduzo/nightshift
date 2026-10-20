import { harnessFacts } from "@nightshift/agents/harness-facts";
import {
	device as deviceTable,
	run,
	step as stepTable,
} from "@nightshift/db/schema";
import {
	type FlowNode,
	isCustomHarness,
	optionProblem,
	type Policy,
	type ResolvedPolicy,
	type Schedule,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	listFlowFiles,
	listFlowSources,
	loadFlowSource,
	readFlowFile,
	readFlowSources,
	readSchedulesFile,
	writeFlowFile,
	writeSchedulesFile,
} from "@nightshift/flows/files";
import { eq, inArray } from "drizzle-orm";

import { createRunBus } from "./bus";
import { createPlacement } from "./device/placement";
import { createDeviceRegistry } from "./device/registry";
import type { WorkRelay } from "./device/remote";
import {
	deriveOpenGate,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
} from "./events";
import {
	type ArchiveRef,
	checkpointSnapshot,
	ownStepFiles,
	readArchive,
	restoreCheckpoint,
	writeArchive,
} from "./exchange/archive";
import type { RunCommandInput } from "./exchange/commands";
import { createEngineExchange } from "./exchange/engine-exchange";
import { createHostSpaces, personOnHost } from "./exchange/host-spaces";
import { applyWalkerMoves } from "./exchange/rows";
import { getRunRow as getRunRowOf, type RunRow } from "./graph/context";
import { createRunner } from "./graph/runner";
import {
	createOfferSlots,
	inForce,
	offeredDevice,
	offerRefusal,
	publishOffer,
	spaceOffers,
	unpublishOffer,
} from "./offers";
import { createProjects, type ListedProject, toProject } from "./projects";
import { createReadModel, parseCalledFlows, parseRunFlow } from "./read-model";
import { createRecovery } from "./recovery";
import { createRunLog, type RunLog } from "./run-log";
import { createRunStart, flowsForRun } from "./run-start";
import {
	createScheduler,
	DEFAULT_SCHEDULE_TICK_MS,
	type ScheduleRecord,
} from "./scheduler";
import { defaultRunSettings, type RunSettings } from "./settings";
import { createSpaceDocuments, deviceNameIn } from "./space/document";
import { parseTranscript, readTranscriptFile } from "./transcripts";
import type {
	Actor,
	Engine,
	EngineOffers,
	EngineOptions,
	MemberChange,
	RunStreamItem,
	RunSummary,
	RunTrigger,
	RunWalker,
	ScheduleResult,
	SpaceEngine,
	StartRunInput,
	TranscriptEntry,
} from "./types";
import { listBranches } from "./worktrees";

/**
 * The engine: projects, flows, schedules, Gates and runs, over the event
 * log as the read model. A run is one LangGraph thread that the runner
 * (`graph/runner.ts`) drives. `createEngine` is the composition root: it
 * wires five deep modules behind small seams and keeps the CRUD that is
 * too shallow to earn a module of its own.
 *
 * - `run-start.ts`: `startRun` validates, checks what this daemon has,
 *   writes `RunStarted` and hands the thread to the runner.
 * - `recovery.ts`: startup recovery, the daemon's automatic resume,
 *   `resumeRun`, `restartStep` and `rerunFrom` (each appends `RunResumed`
 *   before the thread moves).
 * - `read-model.ts`: the summaries, `getRun`, `listGates`, `watchRun`.
 * - `scheduler.ts`: starts the runs of `.nightshift/schedules.json`.
 * - `projects.ts`: projects by remote and their Clones on this computer.
 *   A project is defined in its Space document (`space/document.ts`);
 *   its `project` row is the document's projection.
 *
 * Spaces: `createEngine` returns the Device's engine; `space(id)` is what a
 * person does in one Space. Every method of that view reads and touches
 * that Space's rows only: a project or run of another Space is "not
 * found", the same answer as one that does not exist. The walk, recovery
 * and the scheduler run across every Space on this Device; each row they
 * write takes the Space of its project (`run-start`, `events`).
 *
 * `stopRun`, `resolveGate` and `signalRun` write one run-level fact each
 * and stay here. On a run another Device walks they write nothing: the
 * Walker is the only writer of its run's events, so the action travels to
 * it as a command (`options.relay`), and the Walker applies it. Every
 * other action on such a run is refused; it is read-only here.
 *
 * The exchange (`exchange/`): run history in and out of this Replica by
 * cursor, the commands a Host keeps for Walkers, and the archive. The
 * daemon carries it over its Links. Each module gets its dependencies (db, log, runner, bus,
 * settings, clock) from this file, so a test can stand one up alone.
 */

/** How long a Device waits for a run its Host started to arrive. */
const RUN_ARRIVES_MS = 30_000;

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
	const registry = createDeviceRegistry({ db, log: runLog, now });

	/** Whether a run's own worktree is on this computer: placed here, or before Placement. */
	const placedHere = (row: RunRow) =>
		row.deviceId === null ||
		row.deviceId === device.id ||
		row.deviceId === row.walkerId;

	/** The Person who owns this computer (its `device` row), read when the engine is ready. */
	let ownerId: string | null = null;

	/**
	 * The offered sessions running now, of the runs this computer walks:
	 * what withdrawing an Offer stops. A session is under an Offer when
	 * it names an offered profile (`OfferedSessionInput`).
	 */
	const underOffers = new Map<
		symbol,
		{ runId: string; deviceId: string; spaceId: string; profile: string }
	>();
	function track(entry: {
		runId: string;
		deviceId: string;
		spaceId: string;
		profile: string;
	}): () => void {
		const key = Symbol(entry.runId);
		underOffers.set(key, entry);
		return () => underOffers.delete(key);
	}
	/** The work relay, noting the offered sessions it carries. */
	const work: WorkRelay | undefined = options.work && {
		online: (deviceId, spaceId) =>
			options.work?.online(deviceId, spaceId) ?? false,
		async *call(deviceId, request, signal) {
			const relay = options.work as WorkRelay;
			const { call } = request;
			const untrack =
				call.kind === "session" &&
				"offered" in call.input &&
				request.runId !== null
					? track({
							runId: request.runId,
							deviceId,
							spaceId: request.spaceId,
							profile: call.input.offered.profile,
						})
					: null;
			try {
				yield* relay.call(deviceId, request, signal);
			} finally {
				untrack?.();
			}
		},
	};
	/** At most each Offer's session cap of offered sessions at once, on this computer. */
	const slots = createOfferSlots();

	/** This computer's Offers into a Space that are in force: its own, and the Space lists them. */
	async function offersHere(spaceId: string) {
		return inForce(
			options.ownOffers?.() ?? [],
			spaceOffers(await documents.open(spaceId), device.id),
			spaceId,
		);
	}

	/**
	 * Whether a run is this computer's owner's own (as the Space's Host
	 * knows them), or a schedule's without a Person. Another Person's run
	 * uses this computer through its Offers only.
	 */
	const ownRun = async (row: Pick<RunRow, "startedBy" | "spaceId">) =>
		row.startedBy === null ||
		row.startedBy === ((await personOnHost(db, row.spaceId)) ?? ownerId);

	/** Where steps run: per node, else the run's Device (`device/placement.ts`). */
	const placement = createPlacement({
		db,
		device,
		log: runLog,
		registry,
		documents,
		hostSpaces: createHostSpaces(db),
		project: (projectId, spaceId) => projects.find(projectId, spaceId),
		...(work ? { work } : {}),
		...(options.relay ? { relay: options.relay } : {}),
		// Another Person's run here uses this computer through its Offers.
		localFor: (row) =>
			row.startedBy === null
				? device
				: offeredDevice(device, {
						own: () => ownRun(row),
						inForce: () => offersHere(row.spaceId),
						profileFor: options.profileFor ?? (() => null),
						slots,
						spaceId: row.spaceId,
						track: (profile) =>
							track({
								runId: row.id,
								deviceId: device.id,
								spaceId: row.spaceId,
								profile,
							}),
					}),
		offersHere,
		mayUseOffers: (spaceId, personId) =>
			options.mayUseOffers?.(spaceId, personId) ?? Promise.resolve(false),
	});
	const deviceFor = placement.deviceFor;

	const projects = createProjects({
		db,
		log: runLog,
		deviceId: runLog.walkerId,
		documents,
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
		deviceFor,
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
			const [self] = await db
				.select({ ownerId: deviceTable.ownerId })
				.from(deviceTable)
				.where(eq(deviceTable.self, true));
			ownerId = self?.ownerId ?? null;
		})
		// The interrupted runs' grace counts from now: the engine is ready.
		.then(() => recovery.armResumes());
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});

	const exchange = createEngineExchange({
		db,
		log: runLog,
		bus,
		dataDir,
		documents,
		// A run moved here: this computer walks it from now on.
		onIngested: async (added) => {
			const self = await runLog.walkerId();
			for (const e of added) {
				if (e.type !== "WalkerMoved" || !e.runId) continue;
				if (e.payload.to !== self && e.payload.to !== device.id) continue;
				await takeOver(e.runId).catch((error) => {
					console.error(`[engine] could not take over run ${e.runId}`, error);
				});
			}
		},
		// A Space a Host keeps: that Host's feed of the step, over its link.
		...(options.relay?.follow
			? { upstream: options.relay.follow.bind(options.relay) }
			: {}),
	});

	/**
	 * This computer walks a run another Device moved here (`WalkerMoved`):
	 * its checkpoint comes from the archive (this Replica's, else the Host's)
	 * into the checkpoint tables, and a sleeping run gets its wake timer. A
	 * run at a Gate waits for its answer here; a stopped one for a resume.
	 */
	async function takeOver(runId: string): Promise<void> {
		const row = await getRunRowOf(db, runId);
		const ref: ArchiveRef = {
			kind: "checkpoint",
			spaceId: row.spaceId,
			runId,
		};
		const snapshot =
			(await readArchive(dataDir, ref)) ??
			(options.relay ? await options.relay.archive(ref) : null);
		if (snapshot === null) {
			throw new Error("The archive has no checkpoint of the run.");
		}
		await restoreCheckpoint(db, snapshot);
		runner.forget(runId);
		runner.sleeps.restore(runId, await runLog.events(runId));
	}

	/**
	 * What a new Walker needs of a run this computer walks: its latest
	 * checkpoint and its steps' transcripts and command logs, in the archive
	 * of the Replica that keeps the Space (this one, or its Host).
	 */
	async function archiveForMove(row: RunRow): Promise<void> {
		const keptHere = (await exchange.hostSpaces.hostOf(row.spaceId)) === null;
		const put = async (ref: ArchiveRef, content: string) => {
			if (keptHere) await writeArchive(dataDir, ref, content);
			else if (options.relay) await options.relay.archivePut(ref, content);
			else
				throw new Error("This computer cannot reach the Host of this Space.");
		};
		const self = await runLog.walkerId();
		const steps = await db
			.select({ id: stepTable.id })
			.from(stepTable)
			.where(eq(stepTable.runId, row.id));
		for (const s of steps) {
			const files = await ownStepFiles(db, dataDir, s.id, self);
			if (!files) continue;
			const at = { spaceId: row.spaceId, runId: row.id, stepId: s.id };
			if (files.transcript !== null) {
				await put({ kind: "transcript", ...at }, files.transcript);
			}
			if (files.log !== null) await put({ kind: "log", ...at }, files.log);
		}
		await put(
			{ kind: "checkpoint", spaceId: row.spaceId, runId: row.id },
			await checkpointSnapshot(db, row.id),
		);
	}

	/** The Walkers of runs of a Space: their names from the Device rows, else the Space document. */
	async function walkers(
		spaceId: string,
		ids: readonly string[],
	): Promise<Map<string, RunWalker>> {
		const self = await runLog.walkerId();
		const unique = [...new Set(ids)];
		const others = unique.filter((id) => id !== self && id !== device.id);
		const named = new Map(
			others.length === 0
				? []
				: (
						await db
							.select({ id: deviceTable.id, name: deviceTable.name })
							.from(deviceTable)
							.where(inArray(deviceTable.id, others))
					).map((d) => [d.id, d.name]),
		);
		const document =
			others.length > 0 && others.some((id) => !named.has(id))
				? await documents.open(spaceId)
				: null;
		return new Map(
			unique.map((id) => [
				id,
				{
					id,
					name:
						id === self || id === device.id
							? device.name
							: (named.get(id) ??
								(document ? deviceNameIn(document, id) : null)),
					thisDevice: id === self || id === device.id,
				},
			]),
		);
	}

	/**
	 * A step's transcript: this Replica's own file, or for a run walked
	 * elsewhere the archive's copy, fetched from the Host when this
	 * Replica lacks it. A copy is kept once the step has ended.
	 */
	async function stepTranscript(
		row: { id: string; runId: string; spaceId: string; transcriptPath: string },
		walker: RunWalker,
		ended: boolean,
	): Promise<TranscriptEntry[]> {
		if (walker.thisDevice) {
			// A step of a run walked here before it moved here is in the archive.
			const own = await readTranscriptFile(row.transcriptPath);
			if (own.length > 0 || !ended) return own;
		}
		const ref: ArchiveRef = {
			kind: "transcript",
			spaceId: row.spaceId,
			runId: row.runId,
			stepId: row.id,
		};
		let text = await readArchive(dataDir, ref);
		if (text === null && options.relay) {
			text = await options.relay.archive(ref).catch(() => null);
			if (text !== null && ended) await writeArchive(dataDir, ref, text);
		}
		return text === null ? [] : parseTranscript(text);
	}

	const reads = createReadModel({
		db,
		log: runLog,
		bus,
		isActive: runner.isActive,
		// Any harness, added or not: an old run's session stays takeable.
		// A custom agent has no take-over command.
		harnessOf: (name) =>
			isCustomHarness(name) ? undefined : harnessFacts(name),
		walkers,
		pendingCommands: async (runId) =>
			(await exchange.commands.pendingOf(runId)).map((c) => ({
				id: c.id,
				kind: c.kind,
				createdAt: c.createdAt,
			})),
		stepTranscript,
		followStep: (step, afterSeq, signal) =>
			exchange.feeds.follow(step, afterSeq, signal),
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
	});

	/** The run's row when it is in the Space, else "not found". */
	async function getRunRow(runId: string, spaceId: string): Promise<RunRow> {
		const row = await getRunRowOf(db, runId);
		if (row.spaceId !== spaceId) throw new Error(`Run not found: ${runId}`);
		return row;
	}

	/** Whether another Device walks the run. */
	async function walkedElsewhere(row: RunRow): Promise<boolean> {
		return row.walkerId !== (await runLog.walkerId());
	}

	/** Hands an action on a run walked elsewhere to its Walker, in the actor's name. */
	async function relay(
		row: RunRow,
		actor: Actor | undefined,
		command: RunCommandInput,
	): Promise<void> {
		if (!options.relay) {
			throw new Error(
				"Another device runs this run, and this computer cannot reach it.",
			);
		}
		if (!actor) throw new Error("Sign in to act on a run of another device.");
		await options.relay.command({
			...command,
			spaceId: row.spaceId,
			runId: row.id,
			walkerId: row.walkerId,
			personId: actor.personId,
		});
	}

	const getProjectRow = projects.get;

	const loadRunEvents = (runId: string) => runLog.events(runId);

	const scheduler = createScheduler({
		db,
		now,
		tickMs: internals.scheduleTickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		startRun: startRunWith,
		log: runLog,
		projects: projects.list,
		enabled: () => runSettings().scheduler,
		// The Device a schedule names fires it; without one, the Replica that
		// keeps the Space (its Host, or the one Device of a Space without one).
		firesHere: async (projectId, schedule) => {
			if (schedule.device !== undefined) return schedule.device === device.name;
			const row = await projects.find(projectId);
			return (await exchange.hostSpaces.hostOf(row.spaceId)) === null;
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

	/** A logged schedule fact, with the status of the run it started. */
	async function scheduleResult(
		record: ScheduleRecord | null,
	): Promise<ScheduleResult | null> {
		if (!record) return null;
		if (record.kind !== "fired") return record;
		return { ...record, runStatus: await reads.runStatus(record.runId) };
	}

	/** Rows as the engine's Projects, with their Clones from the Space document. */
	async function withClones(spaceId: string, rows: ListedProject[]) {
		const document = await documents.open(spaceId);
		const deviceId = await runLog.walkerId();
		return rows.map((row) => toProject(row, document, deviceId));
	}

	/** Refuses while a run of the project runs a step. */
	async function noActiveRun(projectId: string, what: string) {
		const runs = await db
			.select({ id: run.id })
			.from(run)
			.where(eq(run.projectId, projectId));
		if (runs.some((r) => runner.isActive(r.id))) {
			throw new Error(
				`A run of this project is still running. Stop it to ${what}.`,
			);
		}
		return runs;
	}

	/** What a person does in one Space. */
	function space(spaceId: string, actor?: Actor): SpaceEngine {
		return {
			async listProjects() {
				await ready;
				return withClones(spaceId, await projects.listInSpace(spaceId));
			},

			async addProject(input) {
				await ready;
				const [added] = await withClones(spaceId, [
					await projects.add(input, spaceId),
				]);
				if (!added) throw new Error("Could not add the project.");
				return added;
			},

			// A rename, a move and a removal are the Space's: they need no Clone here.
			async renameProject(projectId, name) {
				await ready;
				await projects.find(projectId, spaceId);
				await projects.rename(projectId, name);
				const [renamed] = await withClones(spaceId, [
					await projects.find(projectId, spaceId),
				]);
				if (!renamed) throw new Error(`Project not found: ${projectId}`);
				return renamed;
			},

			async moveProject(projectId, toSpaceId) {
				await ready;
				await projects.find(projectId, spaceId);
				await noActiveRun(projectId, "move the project");
				await projects.move(projectId, spaceId, toSpaceId);
			},

			async removeProject(projectId) {
				await ready;
				await projects.find(projectId, spaceId);
				const runs = await noActiveRun(projectId, "remove the project");
				for (const r of runs) {
					const status = deriveRunState(await loadRunEvents(r.id)).status;
					if (status === "waiting") {
						throw new Error(
							"A run of this project waits at a Gate. Answer or stop it first.",
						);
					}
					if (status === "sleeping") {
						throw new Error(
							"A run of this project sleeps until a wait ends. Stop it first.",
						);
					}
				}
				// Runs, events and worktrees stay: a person may still need them.
				await projects.remove(projectId);
			},

			async listBranches(projectId) {
				await ready;
				const row = await getProjectRow(projectId, spaceId);
				return listBranches(row.repoPath);
			},

			async listDevices(projectId) {
				await ready;
				if (!actor) throw new Error("Sign in to see your devices.");
				return placement.devicesFor(spaceId, actor.personId, projectId);
			},

			async listPlacements(projectId) {
				await ready;
				if (!actor) throw new Error("Sign in to start a run.");
				return placement.placements(spaceId, actor.personId, projectId);
			},

			async listFlows(projectId) {
				await ready;
				const row = await projects.find(projectId, spaceId);
				if (row.repoPath !== null) return listFlowFiles(row.repoPath);
				return listFlowSources(
					await placement.flowsElsewhere(spaceId, projectId, actor?.personId),
					"",
				);
			},

			async getFlow(projectId, name) {
				await ready;
				const row = await projects.find(projectId, spaceId);
				if (row.repoPath !== null) return readFlowFile(row.repoPath, name);
				return loadFlowSource(
					await placement.flowsElsewhere(spaceId, projectId, actor?.personId),
					name,
					"",
				);
			},

			async saveFlow(projectId, name, flow) {
				await ready;
				const row = await getProjectRow(projectId, spaceId);
				return writeFlowFile(row.repoPath, name, flow);
			},

			async deleteFlow(projectId, name) {
				await ready;
				const row = await getProjectRow(projectId, spaceId);
				await deleteFlowFile(row.repoPath, name);
			},

			async listRuns(input) {
				await ready;
				const runs = await reads.listRuns(spaceId, input?.projectId);
				const shown = await pathsFor(spaceId, actor);
				return Promise.all(runs.map(shown));
			},

			async getRun(runId) {
				await ready;
				await getRunRow(runId, spaceId);
				return (await pathsFor(spaceId, actor))(await reads.getRun(runId));
			},

			async startRun(input: StartRunInput) {
				await ready;
				await projects.find(input.projectId, spaceId);
				const { deviceId } = input;
				if (
					deviceId !== undefined &&
					deviceId !== device.id &&
					deviceId !== (await runLog.walkerId()) &&
					(await exchange.hostSpaces.hostOf(spaceId)) !== null
				) {
					// A run for another Device: the Space's Host walks it.
					return startOnHost({ ...input, deviceId }, spaceId);
				}
				return (await pathsFor(spaceId, actor))(
					await startRunWith(input, { kind: "manual" }),
				);
			},

			async stopRun(runId, stopOptions) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				if (await walkedElsewhere(row)) {
					const status = deriveRunState(await loadRunEvents(runId)).status;
					if (
						status !== "running" &&
						status !== "waiting" &&
						status !== "sleeping"
					) {
						return;
					}
					await relay(row, actor, {
						kind: "run.stop",
						payload: stopOptions?.when ? { when: stopOptions.when } : {},
					});
					return;
				}
				if (
					stopOptions?.when === "after-step" ||
					stopOptions?.when === "cancel-after-step"
				) {
					const request = stopOptions.when === "after-step";
					await runner.exclusive(runId, async () => {
						const events = await loadRunEvents(runId);
						const status = deriveRunState(events).status;
						if (
							status !== "running" &&
							status !== "waiting" &&
							status !== "sleeping"
						) {
							return;
						}
						if (deriveStopAfterStep(events) === request) return;
						await runLog.append({
							type: request
								? "StopAfterStepRequested"
								: "StopAfterStepCancelled",
							runId,
							payload: {},
						});
						bus.publish(runId, { kind: "status-changed" });
					});
					return;
				}
				await runner.stop(runId);
			},

			async moveRun(runId, to) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				if (!actor) throw new Error("Sign in to move a run.");
				if (await walkedElsewhere(row)) {
					await relay(row, actor, { kind: "run.move", payload: { to } });
					return;
				}
				const self = await runLog.walkerId();
				if (to === self || to === device.id) {
					throw new Error("This computer walks the run already.");
				}
				await runner.exclusive(runId, async () => {
					const events = await loadRunEvents(runId);
					const status = deriveRunState(events).status;
					if (status === "running" || runner.isActive(runId)) {
						throw new Error(
							"The run is in the middle of a step. Move it when it waits, sleeps or has stopped.",
						);
					}
					if (status === "finished") {
						throw new Error("The run has ended. There is nothing to move.");
					}
					const personId =
						(await personOnHost(db, row.spaceId)) ?? actor.personId;
					const target = (
						await placement.ownDevices(row.spaceId, personId, row.projectId)
					).find((d) => d.deviceId === to);
					if (!target || target.thisDevice) {
						throw new Error("That device is not one of yours.");
					}
					if (!target.online) {
						throw new Error(
							`${target.name} is offline. Move the run when it is online.`,
						);
					}
					await archiveForMove(row);
					runner.forget(runId);
					const moved = await runLog.append({
						type: "WalkerMoved",
						runId,
						payload: { from: self, to, by: actor.personId },
					});
					await applyWalkerMoves(db, [moved]);
					bus.publish(runId, { kind: "status-changed" });
				});
			},

			async resumeRun(runId, prompt) {
				await ready;
				await getRunRow(runId, spaceId);
				await recovery.resume(runId, {
					by: "person",
					...(prompt !== undefined ? { prompt } : {}),
				});
			},

			async restartStep(runId, options) {
				await ready;
				await getRunRow(runId, spaceId);
				await recovery.restartStep(runId, {
					by: "person",
					...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
					...(options?.stepId !== undefined ? { stepId: options.stepId } : {}),
				});
			},

			async rerunFrom(runId, options) {
				await ready;
				await getRunRow(runId, spaceId);
				await recovery.rerunFrom(runId, {
					by: "person",
					nodeId: options.nodeId,
					...(options.stepId !== undefined ? { stepId: options.stepId } : {}),
					...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
					...(options.fresh ? { fresh: true } : {}),
				});
			},

			async listGates() {
				await ready;
				return reads.listGates(spaceId);
			},

			async listSchedules(projectId) {
				await ready;
				const row = await getProjectRow(projectId, spaceId);
				const loaded = await readSchedulesFile(row.repoPath);
				await scheduler.refresh();
				const at = now();
				const schedules = [];
				for (const schedule of loaded.schedules) {
					schedules.push({
						...schedule,
						nextAt: scheduler.nextAt(row.id, schedule, at),
						last: await scheduleResult(scheduler.last(row.id, schedule.id)),
						issues: loaded.issues.filter(
							(issue) => issue.scheduleId === schedule.id,
						),
					});
				}
				return {
					path: loaded.path,
					schedules,
					issues: loaded.issues.filter(
						(issue) => issue.scheduleId === undefined,
					),
				};
			},

			async saveSchedules(projectId, schedules) {
				await ready;
				const row = await getProjectRow(projectId, spaceId);
				return writeSchedulesFile(
					row.repoPath,
					await schedulesWithOffers(row, spaceId, actor, schedules),
				);
			},

			async resolveGate({ runId, stepId, choice, note }) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				if (await walkedElsewhere(row)) {
					const gate = deriveOpenGate(await loadRunEvents(runId));
					if (!gate) throw new Error("This run does not wait at a Gate.");
					if (gate.stepId !== stepId) {
						throw new Error(`Step ${stepId} is not the open Gate of this run.`);
					}
					const problem = optionProblem(gate.choices, choice);
					if (problem !== null) throw new Error(problem);
					const pending = await exchange.commands.pendingOf(runId);
					if (pending.some((c) => c.kind === "gate.resolve")) {
						throw new Error(
							"An answer to this Gate is already on its way to the device that runs it.",
						);
					}
					await relay(row, actor, {
						kind: "gate.resolve",
						payload: { stepId, choice, ...(note ? { note } : {}) },
					});
					return;
				}
				await runner.exclusive(runId, async () => {
					const events = await loadRunEvents(runId);
					const gate = deriveOpenGate(events);
					if (!gate) throw new Error("This run does not wait at a Gate.");
					if (gate.stepId !== stepId) {
						throw new Error(`Step ${stepId} is not the open Gate of this run.`);
					}
					const problem = optionProblem(gate.choices, choice);
					if (problem !== null) throw new Error(problem);
					// The thread continues at once, so it needs a slot. A full cap
					// leaves the Gate open.
					runner.reserveSlot(runId);
					try {
						// The Gate node ends the step on the answer. Return once it has,
						// so the run no longer waits when the caller looks again.
						const answered = reads.untilLogged(
							runId,
							(events) =>
								deriveSteps(events).find((s) => s.id === stepId)?.endedAt !==
								null,
						);
						runner.resume(row, { kind: "gate", choice, note: note ?? "" });
						await answered;
					} finally {
						runner.releaseStartingSlot(runId);
					}
				});
			},

			async signalRun(runId, name) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				const sleep = deriveSleep(await loadRunEvents(runId));
				if (!sleep || sleep.signal !== name) {
					throw new Error("This run does not wait for that signal.");
				}
				if (await walkedElsewhere(row)) {
					await relay(row, actor, { kind: "signal.send", payload: { name } });
					return;
				}
				// The thread continues at once, like a wake a person asks for: a
				// full run cap fails here rather than queueing the signal.
				await runner.sleeps.wake(runId, { early: true, signal: name });
			},

			watchRun(runId, { signal: watching, afterSeq }) {
				// A disposed engine publishes nothing more on its bus: the watch
				// ends with it, so the watcher reconnects to the next engine.
				return watch(
					runId,
					spaceId,
					AbortSignal.any([watching, signal]),
					afterSeq ?? 0,
				);
			},
		};
	}

	/**
	 * Has the Host of the Space start a run placed on another Device: the
	 * Host walks it. Returns once the run's rows reached this Replica.
	 */
	async function startOnHost(
		input: StartRunInput & { deviceId: string },
		spaceId: string,
	): Promise<RunSummary> {
		if (!options.relay) {
			throw new Error(
				"The computer that keeps this Space cannot be reached. Try again when it is online.",
			);
		}
		const { runId } = await options.relay.startRun({ ...input, spaceId });
		const deadline = now() + RUN_ARRIVES_MS;
		while (now() < deadline) {
			const [row] = await db
				.select({ id: run.id })
				.from(run)
				.where(eq(run.id, runId));
			if (row && (await runLog.events(runId)).length > 0) {
				const [summary] = (
					await reads.listRuns(spaceId, input.projectId)
				).filter((r) => r.id === runId);
				if (summary) return summary;
			}
			await Bun.sleep(200);
		}
		throw new Error(
			"The run started, but it has not reached this computer yet. It shows in the run list in a moment.",
		);
	}

	async function* watch(
		runId: string,
		spaceId: string,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		await ready;
		await getRunRow(runId, spaceId);
		yield* reads.watch(runId, signal, afterSeq);
	}

	async function deviceBack(_deviceId: string): Promise<void> {
		await ready;
		const self = await runLog.walkerId();
		const rows = await db
			.select({ id: run.id })
			.from(run)
			.where(eq(run.walkerId, self));
		const sleeping = await runLog.derive(
			rows.map((r) => r.id),
			deriveSleep,
		);
		for (const [runId, sleep] of sleeping) {
			// Each looks again: one whose Device is still away sleeps again.
			if (sleep?.reason !== "device-offline") continue;
			runner.sleeps.wake(runId, { early: true }).catch(() => {});
		}
	}

	async function logMemberChange(change: MemberChange): Promise<void> {
		const { spaceId, personId, by } = change;
		if (change.kind === "joined") {
			await runLog.append({
				type: "MemberJoined",
				spaceId,
				payload: {
					personId,
					role: change.role,
					by,
					...(change.invitedBy ? { invitedBy: change.invitedBy } : {}),
				},
			});
		} else if (change.kind === "removed") {
			await runLog.append({
				type: "MemberRemoved",
				spaceId,
				payload: { personId, by },
			});
		} else {
			await runLog.append({
				type: "MemberRoleChanged",
				spaceId,
				payload: {
					personId,
					role: change.role,
					previousRole: change.previousRole,
					by,
				},
			});
		}
	}

	/**
	 * A run as a Person may read it: where its worktree is on its Device
	 * (and the take-over command that names it) only for that Device's
	 * owner. Another Person's Device, or one this Replica cannot tell the
	 * owner of, shows none: the path stays with the Device's owner, as the
	 * exchange keeps the Walker's paths with the Walker's.
	 */
	async function pathsFor(spaceId: string, actor: Actor | undefined) {
		const viewer = actor
			? ((await personOnHost(db, spaceId)) ?? actor.personId)
			: null;
		const here = (await personOnHost(db, spaceId)) ?? ownerId;
		const owners = new Map<string, string | null>();
		return async <
			T extends {
				device: { id: string; thisDevice: boolean };
				worktreePath: string;
				takeOverCommand?: string | null;
			},
		>(
			summary: T,
		): Promise<T> => {
			if (viewer === null) return summary;
			const { id, thisDevice } = summary.device;
			if (!owners.has(id)) {
				owners.set(
					id,
					thisDevice ? here : ((await registry.get(id))?.ownerId ?? null),
				);
			}
			if (owners.get(id) === viewer) return summary;
			return {
				...summary,
				worktreePath: "",
				...("takeOverCommand" in summary ? { takeOverCommand: null } : {}),
			};
		};
	}

	/**
	 * A schedule that fires on another Person's Device starts the saver's
	 * runs there, through that Device's Offers: each such schedule gets the
	 * saver as its `person`, and is refused unless the Offers in the Space
	 * cover what its flow runs on that Device now. A schedule on one of the
	 * saver's own Devices names no Person.
	 */
	async function schedulesWithOffers(
		project: { id: string; repoPath: string },
		spaceId: string,
		actor: Actor | undefined,
		schedules: readonly Schedule[],
	): Promise<Schedule[]> {
		if (!actor || !schedules.some((s) => s.device !== undefined)) {
			return [...schedules];
		}
		const personId = (await personOnHost(db, spaceId)) ?? actor.personId;
		const devices = await placement.devicesFor(spaceId, personId, project.id);
		const document = await documents.open(spaceId);
		const out: Schedule[] = [];
		for (const schedule of schedules) {
			const { person: _old, ...rest } = schedule;
			const named = devices.filter((d) => d.name === schedule.device);
			const own = named.find((d) => d.offers === undefined);
			const theirs = named.find((d) => d.offers !== undefined);
			if (schedule.device === undefined || own || !theirs) {
				out.push(rest);
				continue;
			}
			let nodes: FlowNode[] = [];
			try {
				const loaded = flowsForRun(await readFlowSources(project.repoPath), {
					projectId: project.id,
					flowName: schedule.flow,
				});
				nodes = [loaded.flow, ...Object.values(loaded.calledFlows)]
					.flatMap((f) => f.nodes)
					// The schedule's run starts on that Device: its nodes run there
					// unless they name another.
					.filter(
						(n) => !("device" in n) || !n.device || n.device === theirs.name,
					);
			} catch {
				// A flow that does not load is the schedule's own issue.
			}
			const refusal = offerRefusal(nodes, {
				deviceName: theirs.name,
				offers: theirs.thisDevice
					? await offersHere(spaceId)
					: spaceOffers(document, theirs.deviceId),
				mayUse: (await options.mayUseOffers?.(spaceId, personId)) ?? false,
			});
			if (refusal !== null) {
				throw new Error(
					`The schedule "${schedule.id}" fires on another person's device. ${refusal}`,
				);
			}
			out.push({ ...rest, person: personId });
		}
		return out;
	}

	/** Stops the runs walked here whose running step is a session under the Offer. */
	async function stopUnder(offer: {
		spaceId: string;
		deviceId: string;
		profile: string;
	}): Promise<void> {
		const runIds = new Set(
			[...underOffers.values()]
				.filter(
					(e) =>
						e.spaceId === offer.spaceId &&
						e.deviceId === offer.deviceId &&
						e.profile === offer.profile,
				)
				.map((e) => e.runId),
		);
		await Promise.all(
			[...runIds].map((runId) =>
				runner.stop(runId).catch((error) => {
					console.error(`The run ${runId} was not stopped:`, error);
				}),
			),
		);
	}

	const offers: EngineOffers = {
		async list(spaceId) {
			await ready;
			return spaceOffers(await documents.open(spaceId));
		},

		async publish(input) {
			await ready;
			const { spaceId, by, ...offer } = input;
			if ((await exchange.hostSpaces.hostOf(spaceId)) !== null) {
				if (!options.relay || offer.deviceId !== device.id) {
					throw new Error(
						"The computer that keeps this Space cannot be reached. Try again when it is online.",
					);
				}
				await options.relay.offer({
					spaceId,
					profile: offer.profile,
					deviceName: offer.deviceName,
					permissionCap: offer.permissionCap,
					sessionCap: offer.sessionCap,
				});
				return;
			}
			const document = await documents.open(spaceId);
			await document.change(() =>
				publishOffer(document, { ...offer, offeredAt: now(), by }),
			);
			await runLog.append({
				type: "OfferMade",
				spaceId,
				payload: {
					deviceId: offer.deviceId,
					deviceName: offer.deviceName,
					profile: offer.profile,
					permissionCap: offer.permissionCap,
					sessionCap: offer.sessionCap,
					by,
				},
			});
		},

		async withdraw(input) {
			await ready;
			const { spaceId, deviceId, profile, by } = input;
			if ((await exchange.hostSpaces.hostOf(spaceId)) !== null) {
				if (!options.relay || deviceId !== device.id) {
					throw new Error(
						"The computer that keeps this Space cannot be reached. Try again when it is online.",
					);
				}
				await options.relay.withdrawOffer({ spaceId, profile });
				// The runs this computer walks stop their steps under it too.
				await stopUnder({ spaceId, deviceId, profile });
				return;
			}
			const document = await documents.open(spaceId);
			let removed = false;
			await document.change(() => {
				removed = unpublishOffer(document, deviceId, profile);
			});
			if (removed) {
				await runLog.append({
					type: "OfferWithdrawn",
					spaceId,
					payload: { deviceId, profile, by },
				});
			}
			await stopUnder({ spaceId, deviceId, profile });
		},
	};

	return {
		space,
		devices: registry,
		exchange,
		logMemberChange,
		deviceBack,
		offers,
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

/** The flow's own policy numbers, else the daemon's settings. */
function resolvePolicy(
	own: Policy | undefined,
	defaults: RunSettings["policy"],
): ResolvedPolicy {
	return {
		usageLimitFirstWaitMinutes:
			own?.usageLimitFirstWaitMinutes ?? defaults.usageLimitFirstWaitMinutes,
		usageLimitMaxWaitMinutes:
			own?.usageLimitMaxWaitMinutes ?? defaults.usageLimitMaxWaitMinutes,
		networkGraceMinutes:
			own?.networkGraceMinutes ?? defaults.networkGraceMinutes,
		...(own?.maxSteps !== undefined ? { maxSteps: own.maxSteps } : {}),
	};
}
