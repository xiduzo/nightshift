import { randomUUID } from "node:crypto";
import type { AgentHarness, HarnessName } from "@nightshift/agents/types";
import { project, run } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	optionProblem,
	type Policy,
	type ResolvedPolicy,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	listFlowFiles,
	readFlowFile,
	readSchedulesFile,
	writeFlowFile,
	writeSchedulesFile,
} from "@nightshift/flows/files";
import { and, asc, eq, isNull } from "drizzle-orm";

import { createRunBus } from "./bus";
import {
	deriveOpenGate,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
} from "./events";
import { getRunRow as getRunRowOf, type RunRow } from "./graph/context";
import { createRunner } from "./graph/runner";
import { expandMcpServers, type McpExpansion } from "./mcp";
import { createReadModel, parseCalledFlows, parseRunFlow } from "./read-model";
import { createRecovery } from "./recovery";
import { createRunLog, type RunLog } from "./run-log";
import { createRunStart } from "./run-start";
import {
	createScheduler,
	DEFAULT_SCHEDULE_TICK_MS,
	type ScheduleRecord,
} from "./scheduler";
import { defaultRunSettings, type RunSettings } from "./settings";
import type {
	Engine,
	EngineOptions,
	Project,
	RunStreamItem,
	RunSummary,
	RunTrigger,
	ScheduleResult,
	StartRunInput,
} from "./types";
import { resolveRepoTopLevel } from "./worktrees";

/**
 * The engine: projects, flows, schedules, Gates and runs, over the event
 * log as the read model. A run is one LangGraph thread that the runner
 * (`graph/runner.ts`) drives. `createEngine` is the composition root: it
 * wires four deep modules behind small seams and keeps the CRUD that is
 * too shallow to earn a module of its own.
 *
 * - `run-start.ts`: `startRun` validates, checks what this daemon has,
 *   writes `RunStarted` and hands the thread to the runner.
 * - `recovery.ts`: startup recovery, the daemon's automatic resume and
 *   `resumeRun` (both append `RunResumed` before the thread moves).
 * - `read-model.ts`: the summaries, `getRun`, `listGates`, `watchRun`.
 * - `scheduler.ts`: starts the runs of `.nightshift/schedules.json`.
 *
 * `stopRun`, `resolveGate` and `signalRun` write one run-level fact each
 * and stay here. Each module gets its dependencies (db, log, runner, bus,
 * settings, clock) from this file, so a test can stand one up alone.
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
	const { db, harnesses, dataDir, decider } = options;
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
	const mcpServersFor =
		options.mcpServersFor ??
		(async (node: AgentNode): Promise<McpExpansion> =>
			(node.connections ?? []).length > 0
				? {
						ok: false,
						message: `The node uses connections (${node.connections?.join(", ")}), but there are none. Add them under Agents → Tools.`,
					}
				: expandMcpServers(node.mcpServers, process.env));
	/** The harness of that name, when it is added (Agents page) and built. */
	const harnessFor = (name: HarnessName): AgentHarness | undefined =>
		(options.harnessNames?.().has(name) ?? true) ? harnesses[name] : undefined;

	const bus = createRunBus();
	const runLog = internals.runLog ?? createRunLog(db);
	let disposed = false;
	internals.signal?.addEventListener(
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
		harnessFor,
		...(decider ? { decider } : {}),
		mcpServersFor,
		...(options.cliToolsFor ? { cliToolsFor: options.cliToolsFor } : {}),
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		policyFor: (flow) => resolvePolicy(flow.policy, runSettings().policy),
		...(internals.signal ? { signal: internals.signal } : {}),
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
		resumeGraceMs: internals.resumeGraceMs ?? DAEMON_RESUME_GRACE_MS,
		...(internals.signal ? { signal: internals.signal } : {}),
	});

	const ready = recovery.recoverInterruptedWork();
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});

	const reads = createReadModel({
		db,
		log: runLog,
		bus,
		isActive: runner.isActive,
		// Built harnesses, added or not: an old run's session stays takeable.
		harnessOf: (name) => harnesses[name],
	});

	const runStart = createRunStart({
		db,
		log: runLog,
		runner,
		now,
		projectRow: getProjectRow,
		profileFor: options.profileFor ?? (() => null),
		...(options.probeGit ? { probeGit: options.probeGit } : {}),
		harnessFor,
		connectionNames: () => options.connectionNames?.() ?? new Set(),
		cliNames: () => options.cliNames?.() ?? new Set(),
		findCli: options.findCli ?? ((name: string) => Bun.which(name)),
		decider,
	});

	const getRunRow = (runId: string): Promise<RunRow> => getRunRowOf(db, runId);

	/** A project that a person has not removed. */
	async function getProjectRow(projectId: string) {
		const [row] = await db
			.select()
			.from(project)
			.where(and(eq(project.id, projectId), isNull(project.removedAt)));
		if (!row) throw new Error(`Project not found: ${projectId}`);
		return row;
	}

	const loadRunEvents = (runId: string) => runLog.events(runId);

	function toProject(row: typeof project.$inferSelect): Project {
		return {
			id: row.id,
			name: row.name,
			repoPath: row.repoPath,
			createdAt: row.createdAt.getTime(),
		};
	}

	const scheduler = createScheduler({
		db,
		now,
		tickMs: internals.scheduleTickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		startRun: startRunWith,
		enabled: () => runSettings().scheduler,
		runStatus: reads.runStatus,
	});
	if (options.scheduler !== false) {
		const schedulerSignal = options.scheduler?.signal;
		internals.signal?.addEventListener("abort", () => scheduler.stop(), {
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

	const engine: Engine = {
		async listProjects() {
			await ready;
			const rows = await db
				.select()
				.from(project)
				.where(isNull(project.removedAt))
				.orderBy(asc(project.createdAt));
			return rows.map(toProject);
		},

		async addProject(input) {
			await ready;
			const repoPath = await resolveRepoTopLevel(input.repoPath);
			const [existing] = await db
				.select()
				.from(project)
				.where(eq(project.repoPath, repoPath));
			if (existing) {
				if (existing.removedAt === null) return toProject(existing);
				const [restored] = await db
					.update(project)
					.set({ removedAt: null })
					.where(eq(project.id, existing.id))
					.returning();
				if (!restored) throw new Error("Could not restore the project.");
				await runLog.append({
					type: "ProjectRestored",
					payload: { projectId: existing.id },
				});
				return toProject(restored);
			}

			const id = randomUUID();
			const name = input.name ?? repoPath.split("/").at(-1) ?? repoPath;
			const [row] = await db
				.insert(project)
				.values({ id, name, repoPath })
				.returning();
			if (!row) throw new Error("Could not add the project.");
			await runLog.append({
				type: "ProjectAdded",
				payload: { projectId: id, name, repoPath },
			});
			return toProject(row);
		},

		async removeProject(projectId) {
			await ready;
			await getProjectRow(projectId);
			const runs = await db
				.select({ id: run.id })
				.from(run)
				.where(eq(run.projectId, projectId));
			if (runs.some((r) => runner.isActive(r.id))) {
				throw new Error(
					"A run of this project is still running. Stop it first.",
				);
			}
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
			await db
				.update(project)
				.set({ removedAt: new Date() })
				.where(eq(project.id, projectId));
			await runLog.append({
				type: "ProjectRemoved",
				payload: { projectId },
			});
		},

		async listFlows(projectId) {
			await ready;
			const row = await getProjectRow(projectId);
			return listFlowFiles(row.repoPath);
		},

		async getFlow(projectId, name) {
			await ready;
			const row = await getProjectRow(projectId);
			return readFlowFile(row.repoPath, name);
		},

		async saveFlow(projectId, name, flow) {
			await ready;
			const row = await getProjectRow(projectId);
			return writeFlowFile(row.repoPath, name, flow);
		},

		async deleteFlow(projectId, name) {
			await ready;
			const row = await getProjectRow(projectId);
			await deleteFlowFile(row.repoPath, name);
		},

		async listRuns(input) {
			await ready;
			return reads.listRuns(input?.projectId);
		},

		async getRun(runId) {
			await ready;
			return reads.getRun(runId);
		},

		startRun(input: StartRunInput) {
			return startRunWith(input, { kind: "manual" });
		},

		async stopRun(runId, stopOptions) {
			await ready;
			await getRunRow(runId);
			if (stopOptions?.when === "after-step") {
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
					if (deriveStopAfterStep(events)) return;
					await runLog.append({
						type: "StopAfterStepRequested",
						runId,
						payload: {},
					});
					bus.publish(runId, { kind: "status-changed" });
				});
				return;
			}
			await runner.stop(runId);
		},

		async resumeRun(runId, prompt) {
			await ready;
			await recovery.resume(runId, {
				by: "person",
				...(prompt !== undefined ? { prompt } : {}),
			});
		},

		async listGates() {
			await ready;
			return reads.listGates();
		},

		async listSchedules(projectId) {
			await ready;
			const row = await getProjectRow(projectId);
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
				issues: loaded.issues.filter((issue) => issue.scheduleId === undefined),
			};
		},

		async saveSchedules(projectId, schedules) {
			await ready;
			const row = await getProjectRow(projectId);
			return writeSchedulesFile(row.repoPath, schedules);
		},

		async resolveGate({ runId, stepId, choice, note }) {
			await ready;
			const row = await getRunRow(runId);
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
			await getRunRow(runId);
			const sleep = deriveSleep(await loadRunEvents(runId));
			if (!sleep || sleep.signal !== name) {
				throw new Error("This run does not wait for that signal.");
			}
			// The thread continues at once, like a wake a person asks for: a
			// full run cap fails here rather than queueing the signal.
			await runner.sleeps.wake(runId, { early: true, signal: name });
		},

		watchRun(runId, { signal, afterSeq }) {
			return watch(runId, signal, afterSeq ?? 0);
		},
	};

	async function* watch(
		runId: string,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		await ready;
		yield* reads.watch(runId, signal, afterSeq);
	}

	return engine;
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
