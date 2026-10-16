import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AgentHarness, HarnessName } from "@nightshift/agents/types";
import { event, project, run, step } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type Flow,
	type FlowIssue,
	type FlowNode,
	flowSchema,
	migrateFlow,
	optionProblem,
	type Policy,
	parseFlow,
	type ResolvedPolicy,
	resolveFlowProfiles,
	validateFlow,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	flowsDir,
	listFlowFiles,
	readFlowFile,
	readSchedulesFile,
	writeFlowFile,
	writeSchedulesFile,
} from "@nightshift/flows/files";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { createRunBus } from "./bus";
import {
	countDaemonResumes,
	type DerivedStep,
	deriveEndedAt,
	deriveInputs,
	deriveOpenGate,
	deriveResumes,
	deriveRunState,
	deriveSleep,
	deriveSteps,
	deriveStopAfterStep,
	deriveStopAt,
	deriveTraversals,
	deriveTrigger,
	type EngineEventType,
	groupByRun,
	type LoggedEvent,
	lastHarnessSession,
	openWork,
	parseEventRow,
	type ResumedBy,
	type Scope,
	sumCostUsd,
} from "./events";
import {
	DEFAULT_RESUME_PROMPT,
	getRunRow as getRunRowOf,
	HARNESS_LABEL,
	messageOf,
	type RunRow,
} from "./graph/context";
import { createRunner, type ThreadState } from "./graph/runner";
import { resolveInputs } from "./inputs";
import { expandMcpServers, type McpExpansion } from "./mcp";
import { createRunLog, type RunLog } from "./run-log";
import {
	createScheduler,
	DEFAULT_SCHEDULE_TICK_MS,
	type ScheduleRecord,
} from "./scheduler";
import { defaultRunSettings, type RunSettings } from "./settings";
import { readRunTranscript } from "./transcripts";
import type {
	Engine,
	EngineOptions,
	ItemSummary,
	OpenGate,
	Project,
	RunDetail,
	RunStatus,
	RunStreamItem,
	RunSummary,
	RunTrigger,
	ScheduleResult,
	StartRunInput,
	StepSummary,
	TranscriptEntry,
} from "./types";
import { createWorktree, resolveRepoTopLevel } from "./worktrees";

/**
 * The engine: projects, flows, schedules, Gates and runs, over the event
 * log as the read model. A run is one LangGraph thread that the runner
 * (`graph/runner.ts`) drives; `startRun`, `stopRun`, `resumeRun` and
 * `resolveGate` validate, write the run-level facts (`RunStarted`,
 * `RunResumed`, `StopAfterStepRequested`) and hand the thread to it.
 */

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_MAX_STEPS_PER_RUN = 500;
const INTERRUPTED_REASON = "Night Shift stopped while this run ran.";
/** How long a new daemon waits before it resumes the runs the last one stopped mid-step. */
const DAEMON_RESUME_GRACE_MS = 5_000;
/** Daemon resumes in a row (no person in between) before a run waits for a person. */
const MAX_DAEMON_RESUMES = 3;
const DAEMON_RESUME_REASON = "Night Shift restarted.";
/** The follow-up prompt of an Agent session that the daemon continues after a restart. */
const DAEMON_RESUME_PROMPT =
	"Night Shift stopped while you worked on this, so your last actions may or may not have happened. Before you repeat any of them, check the worktree (git status, git log) and the remote (pushed branches, pull requests, comments). Then continue where you left off.";
const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

/**
 * The command a person runs in the worktree to take over a harness session,
 * given the quoted session id.
 *
 * - Claude Code: `claude --resume <id>`.
 * - OpenCode: `opencode --session <id>` opens the TUI on that session. The
 *   flag is from the OpenCode CLI docs (`-s, --session`); it was not checked
 *   against a 1.x binary here. Use the same 1.x build the daemon runs.
 * - Codex: `codex resume <id>` opens the interactive CLI on that thread.
 */
const takeOverCli: Record<HarnessName, (sessionId: string) => string> = {
	"claude-code": (id) => `claude --resume ${id}`,
	opencode: (id) => `opencode --session ${id}`,
	codex: (id) => `codex resume ${id}`,
};

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

/** Event types that open or close work. Startup recovery reads only these. */
const LIFECYCLE_EVENT_TYPES = [
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"SessionStarted",
	"SessionEnded",
	"GateOpened",
	"WaitStarted",
	"WaitEnded",
] as const satisfies readonly EngineEventType[];

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
	/** Interrupted runs the daemon resumes when a slot frees. */
	const pendingResumes = new Set<string>();
	let resumeTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	internals.signal?.addEventListener(
		"abort",
		() => {
			disposed = true;
			clearTimeout(resumeTimer);
			pendingResumes.clear();
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
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		policyFor: (flow) => resolvePolicy(flow.policy, runSettings().policy),
		...(internals.signal ? { signal: internals.signal } : {}),
		onSlotFreed() {
			if (disposed) return;
			for (const runId of [...pendingResumes]) {
				pendingResumes.delete(runId);
				void resumeAfterRestart(runId);
			}
		},
	});

	const ready = recoverInterruptedWork();
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});

	/**
	 * A daemon that died left sessions, steps and runs open. They become
	 * `interrupted`. A moment later the daemon resumes those runs itself, as
	 * a person would, unless `daemonResumeBlock` says why not; the run's end
	 * reason says it. Open Gates and sleeping steps are facts, not lost work:
	 * a sleeping run gets its timer back (a wake time in the past fires at
	 * once).
	 */
	async function recoverInterruptedWork(): Promise<void> {
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					isNotNull(event.runId),
					inArray(event.type, [...LIFECYCLE_EVENT_TYPES]),
				),
			)
			.orderBy(asc(event.seq));
		const byRun = groupByRun(rows.map(parseEventRow));
		const error = "Night Shift stopped while this ran.";
		const toResume: string[] = [];
		for (const [runId, events] of byRun) {
			const open = openWork(events);
			for (const session of open.sessions) {
				await runLog.append({
					type: "SessionEnded",
					runId,
					stepId: session.stepId,
					sessionId: session.id,
					payload: {
						outcome: "interrupted",
						error,
						errorKind: null,
						usage: null,
						costUsd: null,
						resetAt: null,
					},
				});
			}
			for (const open_ of open.steps) {
				await runLog.append({
					type: "StepEnded",
					runId,
					stepId: open_.id,
					payload: {
						outcome: "interrupted",
						outputs: { ...open_.outputs, outcome: "interrupted" },
						error,
					},
				});
			}
			if (open.runOpen) {
				const why = await daemonResumeBlock(runId, events);
				await runLog.append({
					type: "RunEnded",
					runId,
					payload: {
						status: "interrupted",
						reason: why
							? `${INTERRUPTED_REASON} It did not continue on its own: ${why}`
							: INTERRUPTED_REASON,
					},
				});
				if (!why) toResume.push(runId);
			}
			const sleep = deriveSleep(events);
			if (sleep && !open.runOpen) runner.scheduleWake(runId, sleep.until);
		}
		if (toResume.length > 0 && !disposed) {
			resumeTimer = setTimeout(() => {
				for (const runId of toResume) void resumeAfterRestart(runId);
			}, internals.resumeGraceMs ?? DAEMON_RESUME_GRACE_MS);
			resumeTimer.unref?.();
		}
	}

	/**
	 * Why the daemon must not resume a run it stopped mid-step, or null. Only
	 * a daemon with the scheduler on resumes: a dev daemon on a copy of the
	 * database never continues the night's runs on real repos.
	 */
	async function daemonResumeBlock(
		runId: string,
		events: readonly LoggedEvent[],
	): Promise<string | null> {
		try {
			if (options.scheduler === false || !runSettings().scheduler) {
				return "schedules are paused.";
			}
			const [row] = await db.select().from(run).where(eq(run.id, runId));
			if (!row) return "the run's record is missing.";
			const own = parseRunFlow(row).policy?.resumeInterruptedRuns;
			if (!(own ?? runSettings().resumeInterruptedRuns)) {
				return own === false
					? "its flow turns automatic resume off."
					: "automatic resume is off in Settings.";
			}
			const resumes = countDaemonResumes(events);
			if (resumes >= MAX_DAEMON_RESUMES) {
				return `it continued on its own ${resumes} times in a row, and each time Night Shift stopped again.`;
			}
			const stopAt = deriveStopAt(events);
			if (stopAt !== null && now() >= stopAt) {
				return "its stop time has passed.";
			}
			const worktree = await stat(row.worktreePath).catch(() => null);
			if (!worktree?.isDirectory()) {
				return "the copy of the project it worked in is gone.";
			}
			return null;
		} catch (error) {
			return `Night Shift could not check it: ${messageOf(error)}`;
		}
	}

	/**
	 * Resumes a run that startup recovery interrupted, through the same path
	 * as a person's resume. Checks again first: a person may have resumed it,
	 * or the stop time came meanwhile. A full run cap queues it.
	 */
	async function resumeAfterRestart(runId: string): Promise<void> {
		if (disposed) return;
		try {
			await ready;
			const events = await loadRunEvents(runId);
			if (
				runner.isActive(runId) ||
				deriveRunState(events).status !== "interrupted"
			) {
				return;
			}
			const why = await daemonResumeBlock(runId, events);
			if (why) {
				console.warn(
					`[engine] run ${runId} did not continue on its own: ${why}`,
				);
				return;
			}
			await resume(runId, { by: "daemon" });
		} catch (error) {
			console.error(`[engine] could not resume run ${runId}`, error);
		}
	}

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

	function loadRunEvents(runId: string): Promise<LoggedEvent[]> {
		return runLog.events(runId);
	}

	function parseRunFlow(row: RunRow): Flow {
		return snapshotFlow(JSON.parse(row.flow));
	}

	/** The `body_flows` column holds every called flow (Subflow and For Each). */
	function parseCalledFlows(row: RunRow): Record<string, Flow> {
		const raw = JSON.parse(row.bodyFlows || "{}") as Record<string, unknown>;
		const flows: Record<string, Flow> = {};
		for (const [name, flow] of Object.entries(raw)) {
			flows[name] = snapshotFlow(flow);
		}
		return flows;
	}

	/** What a run summary reads from the log. The run log keeps it per run until the next append. */
	function runFacts(events: readonly LoggedEvent[]) {
		const state = deriveRunState(events);
		const open =
			state.status === "running" ||
			state.status === "waiting" ||
			state.status === "sleeping";
		return {
			status: state.status,
			reason: state.reason,
			wakeAt:
				state.status === "sleeping"
					? (deriveSleep(events)?.until ?? null)
					: null,
			inputs: deriveInputs(events),
			stopAt: deriveStopAt(events),
			stopAfterStep: open && deriveStopAfterStep(events),
			costUsd: sumCostUsd(events),
			endedAt: deriveEndedAt(events),
			trigger: deriveTrigger(events),
		};
	}

	function toSummary(
		row: RunRow,
		facts: ReturnType<typeof runFacts>,
	): RunSummary {
		return {
			id: row.id,
			projectId: row.projectId,
			flowName: row.flowName,
			title: row.title,
			worktreePath: row.worktreePath,
			branch: row.branch,
			baseRef: row.baseRef,
			...facts,
			createdAt: row.createdAt.getTime(),
		};
	}

	function toStepSummary(derived: DerivedStep): StepSummary {
		return {
			id: derived.id,
			nodeId: derived.nodeId,
			nodeType: derived.nodeType,
			visit: derived.visit,
			startedAt: derived.startedAt,
			endedAt: derived.endedAt,
			outcome: derived.outcome,
			outputs: derived.outputs,
			error: derived.error,
			scope: derived.scope,
			items: derived.items.map(
				(item): ItemSummary => ({
					id: item.facts.id,
					title: item.facts.title,
					url: item.facts.url,
					value: item.facts.value,
					state: item.state,
					branch: item.branch,
					baseBranch: item.baseBranch,
					startedAt: item.startedAt,
					endedAt: item.endedAt,
					reason: item.reason,
				}),
			),
			sessions: derived.sessions.map((s) => ({
				id: s.id,
				harnessSessionId: s.harnessSessionId,
				prompt: s.prompt,
				createdAt: s.startedAt,
				outcome: s.ending?.outcome ?? null,
				error: s.ending?.error ?? null,
				costUsd: s.ending?.costUsd ?? null,
			})),
			costUsd: derived.costUsd,
			gate: derived.gate
				? {
						question: derived.gate.question,
						choices: derived.gate.choices,
						openedAt: derived.gate.openedAt,
					}
				: null,
		};
	}

	/**
	 * Continues a stopped, failed or interrupted run, or wakes a sleeping
	 * one. A person's resume and the daemon's after a restart both come
	 * here; `RunResumed` says which, and is appended before the thread
	 * moves (design rule 9). The daemon's queues on a full run cap, like a
	 * wake. Where the thread continues comes from its checkpoint:
	 *
	 * - at a wait or a parked step → `Command({ resume: { kind: "resume", prompt } })`;
	 * - at a Gate (the run was stopped there) → `{ kind: "reopen" }`;
	 * - a node pending without an interrupt (the daemon died, or the engine
	 *   failed, while it ran) → `invoke(null)` re-runs that node;
	 * - a thread that ended or never ran (a run from before this engine, or
	 *   a finished one whose checkpoints the runner deleted) → jump to the
	 *   top-level node the log points at, with the state seeded from the log.
	 */
	async function resume(
		runId: string,
		input: { by: ResumedBy; prompt?: string },
	): Promise<void> {
		const { prompt } = input;
		const row = await getRunRow(runId);
		const before = await loadRunEvents(runId);
		if (deriveRunState(before).status === "sleeping") {
			await runner.wake(runId, {
				early: true,
				...(prompt !== undefined ? { prompt } : {}),
			});
			return;
		}
		if (
			input.by === "daemon" &&
			!runner.isActive(runId) &&
			runner.activeCount() >= runSettings().maxConcurrentRuns
		) {
			pendingResumes.add(runId);
			return;
		}
		runner.reserveSlot(runId);
		try {
			const events = await loadRunEvents(runId);
			const status = deriveRunState(events).status;
			if (status === "running") {
				throw new Error(
					"This run is still running. Stop it or wait for it to end.",
				);
			}
			if (status === "waiting") {
				throw new Error(
					"This run waits at a Gate. Answer the Gate, or stop the run first.",
				);
			}
			if (status === "sleeping") {
				throw new Error(
					"This run sleeps until a wait ends. Resume it again to wake it now.",
				);
			}
			const flow = parseRunFlow(row);
			const target = resumeTarget(events) ?? {
				nodeId: flow.start,
				stepId: null,
				scope: null,
				topNodeId: flow.start,
			};
			const thread: ThreadState = await runner.threadState(row);
			const resumedPrompt =
				prompt ??
				(input.by === "daemon" ? DAEMON_RESUME_PROMPT : DEFAULT_RESUME_PROMPT);
			const stopAt = deriveStopAt(events);
			await runLog.append({
				type: "RunResumed",
				runId,
				payload: {
					nodeId: target.nodeId,
					stepId: target.stepId,
					prompt: target.stepId ? resumedPrompt : null,
					scope: target.scope,
					...(stopAt !== null && now() >= stopAt ? { clearStopAt: true } : {}),
					by: input.by,
					...(input.by === "daemon" ? { reason: DAEMON_RESUME_REASON } : {}),
				},
			});
			switch (thread.kind) {
				case "interrupted":
					runner.resume(
						row,
						thread.value.kind === "gate"
							? { kind: "reopen" }
							: { kind: "resume", prompt: resumedPrompt },
					);
					break;
				case "pending":
					runner.continueRun(row);
					break;
				case "ended":
				case "fresh":
					runner.reenter(row, target.topNodeId, events);
					break;
			}
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	/**
	 * Resolves once `done` holds for the run's log, or the run's drive ended
	 * without it. Subscribes before the first look, so an append between the
	 * two is not missed.
	 */
	function untilLogged(
		runId: string,
		done: (events: readonly LoggedEvent[]) => boolean,
	): Promise<void> {
		return new Promise<void>((resolve) => {
			let settled = false;
			const unsubscribe = bus.subscribe(runId, () => void check());
			async function check(): Promise<void> {
				if (settled) return;
				const events = await loadRunEvents(runId);
				if (settled) return;
				if (done(events) || !runner.isActive(runId)) {
					settled = true;
					unsubscribe();
					resolve();
				}
			}
			void check();
		});
	}

	function shellQuote(value: string): string {
		if (/^[\w@%+=:,./-]+$/.test(value)) return value;
		return `'${value.replaceAll("'", `'\\''`)}'`;
	}

	function toProject(row: typeof project.$inferSelect): Project {
		return {
			id: row.id,
			name: row.name,
			repoPath: row.repoPath,
			createdAt: row.createdAt.getTime(),
		};
	}

	function quickRunTitle(flow: Flow): string {
		const agent = flow.nodes.find((n) => n.type === "agent");
		const text = (agent?.prompt ?? "").replace(/\s+/g, " ").trim();
		if (!text) return QUICK_RUN_TITLE;
		if (text.length <= TITLE_MAX_CHARS) return text;
		return `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
	}

	function refuseErrors(issues: readonly FlowIssue[], what = "The flow"): void {
		const errors = issues.filter((i) => i.severity === "error");
		if (errors.length === 0) return;
		const list = errors.map((e) => `- ${e.message}`).join("\n");
		throw new Error(
			`${what} cannot run. Fix ${errors.length === 1 ? "this error" : `these ${errors.length} errors`} first:\n${list}`,
		);
	}

	/**
	 * Loads, parses and validates the flow a run starts from, and every flow
	 * it can call through Subflow and For Each nodes (by name, from the
	 * project's flow files). Version 1 files migrate first.
	 */
	async function flowsForRun(
		repoPath: string,
		input: StartRunInput,
	): Promise<{
		flow: Flow;
		flowName: string | null;
		calledFlows: Record<string, Flow>;
	}> {
		const raw = await readProjectFlowFiles(repoPath);
		const files: Record<string, Flow | null> = {};
		for (const [name, json] of Object.entries(raw)) {
			const parsed = flowSchema.safeParse(migrateFlow(json));
			files[name] = parsed.success ? parsed.data : null;
		}
		let flow: Flow;
		let flowName: string | null;
		if (input.flowName !== undefined) {
			if (!Object.hasOwn(raw, input.flowName)) {
				throw new Error(`The flow "${input.flowName}" does not exist.`);
			}
			const parsed = parseFlow(migrateFlow(raw[input.flowName]), {
				flows: files,
				name: input.flowName,
			});
			refuseErrors(parsed.issues);
			if (!parsed.flow) {
				throw new Error(`The flow "${input.flowName}" is not valid.`);
			}
			flow = parsed.flow;
			flowName = input.flowName;
		} else {
			const parsed = parseFlow(migrateFlow(input.flow), { flows: files });
			refuseErrors(parsed.issues);
			if (!parsed.flow) throw new Error("The flow is not valid.");
			flow = parsed.flow;
			flowName = null;
		}
		const calledFlows: Record<string, Flow> = {};
		const queue = calledFlowNames(flow);
		while (queue.length > 0) {
			const name = queue.shift() as string;
			if (Object.hasOwn(calledFlows, name)) continue;
			const called = name === flowName ? flow : files[name];
			if (!called) {
				throw new Error(
					`The called flow "${name}" ${called === null ? "is not valid" : "does not exist"}.`,
				);
			}
			refuseErrors(
				validateFlow(called, { flows: files, name }),
				`The called flow "${name}"`,
			);
			calledFlows[name] = called;
			queue.push(...calledFlowNames(called));
		}
		return { flow, flowName, calledFlows };
	}

	/**
	 * Validates the flow (refuses one with errors), snapshots it, creates the
	 * worktree, starts the thread at the start node, and returns at once.
	 */
	async function startRunWith(
		input: StartRunInput,
		trigger: RunTrigger,
	): Promise<RunSummary> {
		await ready;
		const runId = randomUUID();
		runner.reserveSlot(runId);
		try {
			const projectRow = await getProjectRow(input.projectId);
			const loaded = await flowsForRun(projectRow.repoPath, input);
			const { flowName } = loaded;
			// The run's copy holds the profiles as they are now: a later
			// change to a profile reaches the next run, not this one.
			const unknownProfiles = new Map<string, string[]>();
			const profileFor = options.profileFor ?? (() => null);
			const flow = resolveFlowProfiles(
				loaded.flow,
				profileFor,
				unknownProfiles,
			);
			const calledFlows = Object.fromEntries(
				Object.entries(loaded.calledFlows).map(([name, called]) => [
					name,
					resolveFlowProfiles(called, profileFor, unknownProfiles),
				]),
			);
			if (unknownProfiles.size > 0) {
				throw new Error(
					[...unknownProfiles]
						.map(
							([name, nodeIds]) =>
								`The flow uses the profile "${name}" (${nodeIds.join(", ")}), but no profile has that name. Add it under Agents.`,
						)
						.join(" "),
				);
			}
			const all = [flow, ...Object.values(calledFlows)];
			const nodes = all.flatMap((f) => f.nodes);
			const unknownConnections = missingNames(
				nodes,
				(node) => node.connections ?? [],
				options.connectionNames?.() ?? new Set(),
			);
			if (unknownConnections.length > 0) {
				throw new Error(
					unknownConnections
						.map(
							({ name, nodeIds }) =>
								`The flow uses the connection "${name}" (${nodeIds.join(", ")}), but no connection has that name. Add it under Agents → Tools.`,
						)
						.join(" "),
				);
			}
			const unknownClis = missingNames(
				nodes,
				(node) => node.clis ?? [],
				options.cliNames?.() ?? new Set(),
			);
			if (unknownClis.length > 0) {
				throw new Error(
					unknownClis
						.map(
							({ name, nodeIds }) =>
								`The flow uses the CLI tool "${name}" (${nodeIds.join(", ")}), but no CLI tool has that name. Add it under Agents → Tools.`,
						)
						.join(" "),
				);
			}
			const findCli = options.findCli ?? ((name: string) => Bun.which(name));
			const notFound = [
				...new Set(
					nodes.flatMap((n) => (n.type === "agent" ? (n.clis ?? []) : [])),
				),
			].filter((name) => findCli(name) === null);
			if (notFound.length > 0) {
				throw new Error(
					notFound
						.map(
							(name) =>
								`The flow uses the CLI tool "${name}", but this computer does not have it. Install ${name}, or take it off the flow.`,
						)
						.join(" "),
				);
			}
			const missing = missingHarnesses(nodes, harnessFor);
			if (missing.length > 0) {
				throw new Error(
					missing
						.map(
							({ harness, nodeIds }) =>
								`The flow has ${nodeIds.length === 1 ? "an Agent node" : "Agent nodes"} on ${HARNESS_LABEL[harness]} (${nodeIds.join(", ")}), but no ${HARNESS_LABEL[harness]} harness is added. Add it under Agents.`,
						)
						.join(" "),
				);
			}
			if (
				!decider &&
				nodes.some((n) => n.type === "decision" && n.by === "model")
			) {
				throw new Error(
					"The flow has a Decision node decided by a model, but no decider is configured.",
				);
			}
			if (input.stopAt !== undefined && input.stopAt <= now()) {
				throw new Error("The stop time has passed already.");
			}
			const inputs = resolveInputs(flow.inputs ?? [], input.inputs, {
				what: "The flow",
				jsonText: "strict",
			});
			const textInputs = (flow.inputs ?? []).flatMap((def) => {
				const value = inputs[def.name];
				return (def.type ?? "text") === "text" &&
					typeof value === "string" &&
					value !== ""
					? [`${def.name} ${value}`]
					: [];
			});
			const title = flowName
				? [flowName, ...textInputs].join(" · ").slice(0, 120)
				: quickRunTitle(flow);
			const worktree = await createWorktree({
				repoPath: projectRow.repoPath,
				shortId: runId.slice(0, 8),
				baseRef: input.baseRef,
			});
			const [row] = await db
				.insert(run)
				.values({
					id: runId,
					projectId: projectRow.id,
					flowName,
					flow: JSON.stringify(flow),
					bodyFlows: JSON.stringify(calledFlows),
					title,
					worktreePath: worktree.worktreePath,
					branch: worktree.branch,
					baseRef: worktree.baseRef,
				})
				.returning();
			if (!row) throw new Error("Could not create the run.");
			await runLog.append({
				type: "RunStarted",
				runId,
				payload: {
					projectId: projectRow.id,
					flowName,
					title,
					start: flow.start,
					stopAt: input.stopAt ?? null,
					inputs,
					trigger,
				},
			});
			await runLog.append({
				type: "WorktreeCreated",
				runId,
				payload: worktree,
			});
			runner.start(row, inputs);
			return toSummary(row, runFacts(await loadRunEvents(runId)));
		} finally {
			runner.releaseStartingSlot(runId);
		}
	}

	const scheduler = createScheduler({
		db,
		now,
		tickMs: internals.scheduleTickMs ?? DEFAULT_SCHEDULE_TICK_MS,
		startRun: startRunWith,
		enabled: () => runSettings().scheduler,
		async runStatus(runId) {
			const events = await loadRunEvents(runId);
			return events.length === 0 ? null : deriveRunState(events).status;
		},
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

	/** A logged schedule fact, with the status of the run it started. */
	async function scheduleResult(
		record: ScheduleRecord | null,
	): Promise<ScheduleResult | null> {
		if (!record) return null;
		if (record.kind !== "fired") return record;
		const events = await loadRunEvents(record.runId);
		return {
			...record,
			runStatus: events.length > 0 ? deriveRunState(events).status : null,
		};
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
			const query = db.select().from(run);
			const rows = await (input?.projectId
				? query.where(eq(run.projectId, input.projectId))
				: query
			).orderBy(desc(run.createdAt));
			const facts = await runLog.derive(
				rows.map((r) => r.id),
				runFacts,
			);
			return rows.map((row) =>
				toSummary(row, facts.get(row.id) ?? runFacts([])),
			);
		},

		async getRun(runId) {
			await ready;
			const row = await getRunRow(runId);
			const events = await loadRunEvents(runId);
			const last = lastHarnessSession(events);
			const detail: RunDetail = {
				...toSummary(row, runFacts(events)),
				flow: parseRunFlow(row),
				calledFlows: parseCalledFlows(row),
				steps: deriveSteps(events).map(toStepSummary),
				// Edges of the top-level flow; body edges count per item.
				traversals: deriveTraversals(events),
				takeOverCommand: last
					? `cd ${shellQuote(row.worktreePath)} && ${takeOverCli[last.harness](shellQuote(last.harnessSessionId))}`
					: null,
				resumes: deriveResumes(events),
			};
			return detail;
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
			await resume(runId, {
				by: "person",
				...(prompt !== undefined ? { prompt } : {}),
			});
		},

		async listGates() {
			await ready;
			const rows = await db
				.select({ run, projectName: project.name })
				.from(run)
				.innerJoin(project, eq(run.projectId, project.id))
				.where(isNull(project.removedAt));
			// Only a waiting run has an open Gate. The run list keeps the same facts.
			const facts = await runLog.derive(
				rows.map((r) => r.run.id),
				runFacts,
			);
			const open = await runLog.derive(
				rows
					.map((r) => r.run.id)
					.filter((id) => facts.get(id)?.status === "waiting"),
				deriveOpenGate,
			);
			const gates: OpenGate[] = [];
			for (const { run: row, projectName } of rows) {
				const gate = open.get(row.id);
				if (!gate) continue;
				gates.push({
					runId: row.id,
					runTitle: row.title,
					projectId: row.projectId,
					projectName,
					stepId: gate.stepId,
					nodeId: gate.nodeId,
					question: gate.question,
					choices: gate.choices,
					openedAt: gate.openedAt,
				});
			}
			return gates.sort((a, b) => a.openedAt - b.openedAt);
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
					const answered = untilLogged(
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
		await getRunRow(runId);
		if (signal.aborted) return;

		const queue: (
			| { kind: "transcript"; entry: TranscriptEntry }
			| { kind: "status-changed" }
			| { kind: "step-changed"; stepId: string }
		)[] = [];
		let wakeWatcher: (() => void) | null = null;
		const notify = () => {
			const resolve = wakeWatcher;
			wakeWatcher = null;
			resolve?.();
		};
		// Subscribe before reading the log and the disk: an entry is on disk
		// before it is published, so every entry is either on disk or queued.
		const unsubscribe = bus.subscribe(runId, (item) => {
			queue.push(item);
			notify();
		});
		signal.addEventListener("abort", notify, { once: true });

		try {
			let lastSeq = afterSeq;
			const events = await loadRunEvents(runId);
			let lastStatus: RunStatus = deriveRunState(events).status;
			yield { kind: "status", status: lastStatus };

			const steps = deriveSteps(events);
			for (const derived of steps) {
				if (signal.aborted) return;
				yield { kind: "step", step: toStepSummary(derived) };
			}

			const rows = await db
				.select({ transcriptPath: step.transcriptPath })
				.from(step)
				.where(eq(step.runId, runId));
			const replay = await readRunTranscript(rows.map((s) => s.transcriptPath));
			for (const entry of replay) {
				if (signal.aborted) return;
				if (entry.seq <= lastSeq) continue;
				lastSeq = entry.seq;
				yield { kind: "transcript", entry };
			}

			while (!signal.aborted) {
				const item = queue.shift();
				if (!item) {
					await new Promise<void>((resolve) => {
						wakeWatcher = resolve;
					});
					continue;
				}
				if (item.kind === "transcript") {
					if (item.entry.seq <= lastSeq) continue;
					lastSeq = item.entry.seq;
					yield item;
				} else if (item.kind === "step-changed") {
					const current = deriveSteps(await loadRunEvents(runId)).find(
						(s) => s.id === item.stepId,
					);
					if (current) yield { kind: "step", step: toStepSummary(current) };
				} else {
					const status = deriveRunState(await loadRunEvents(runId)).status;
					if (status !== lastStatus) {
						lastStatus = status;
						yield { kind: "status", status };
					}
				}
			}
		} finally {
			unsubscribe();
			signal.removeEventListener("abort", notify);
		}
	}

	return engine;
}

/**
 * What `RunResumed` records: the node the run continues at, from the log.
 * When the run took an edge after its last step started (it stopped or
 * died between steps), that edge's target; else the last step's node, with
 * its id when it is an Agent step with a harness session to continue, and
 * its scope. `topNodeId` is the top-level node around it, for a thread
 * that has to be re-entered from the root. Null when the run never
 * started a step.
 */
function resumeTarget(events: readonly LoggedEvent[]): {
	nodeId: string;
	stepId: string | null;
	scope: Scope | null;
	topNodeId: string;
} | null {
	const steps = deriveSteps(events);
	const last = steps.at(-1);
	let lastEdge: Extract<LoggedEvent, { type: "EdgeTaken" }> | null = null;
	for (const e of events) {
		if (e.type === "EdgeTaken" && (!lastEdge || e.seq > lastEdge.seq)) {
			lastEdge = e;
		}
	}
	let nodeId: string;
	let stepId: string | null = null;
	let scope: Scope | null;
	if (lastEdge && (!last || lastEdge.seq > last.startSeq)) {
		nodeId = lastEdge.payload.to;
		scope = lastEdge.payload.scope ?? null;
	} else if (last) {
		nodeId = last.nodeId;
		scope = last.scope;
		if (
			last.nodeType === "agent" &&
			last.sessions.some((s) => s.harnessSessionId)
		) {
			stepId = last.id;
		}
	} else {
		return null;
	}
	const byId = new Map(steps.map((s) => [s.id, s]));
	let topNodeId = nodeId;
	for (let at = scope; at; ) {
		const caller = byId.get(at.parentStepId);
		if (!caller) break;
		topNodeId = caller.nodeId;
		at = caller.scope;
	}
	return { nodeId, stepId, scope, topNodeId };
}

/**
 * The raw JSON of every flow file of a project, by name. A file that is not
 * JSON reads as null. A missing directory is an empty record.
 */
async function readProjectFlowFiles(
	repoPath: string,
): Promise<Record<string, unknown>> {
	const dir = flowsDir(repoPath);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return {};
	}
	const files: Record<string, unknown> = {};
	for (const file of names.filter((n) => n.endsWith(".json")).sort()) {
		const text = await readFile(join(dir, file), "utf8");
		try {
			files[file.slice(0, -".json".length)] = JSON.parse(text);
		} catch {
			files[file.slice(0, -".json".length)] = null;
		}
	}
	return files;
}

/** The harnesses the Agent nodes name that the daemon has not configured, with their nodes. */
function missingHarnesses(
	nodes: readonly FlowNode[],
	harnessFor: (name: HarnessName) => AgentHarness | undefined,
): { harness: HarnessName; nodeIds: string[] }[] {
	const missing = new Map<HarnessName, string[]>();
	for (const node of nodes) {
		if (node.type !== "agent" || node.harness === undefined) continue;
		if (harnessFor(node.harness)) continue;
		const ids = missing.get(node.harness) ?? [];
		if (!ids.includes(node.id)) ids.push(node.id);
		missing.set(node.harness, ids);
	}
	return [...missing].map(([harness, nodeIds]) => ({ harness, nodeIds }));
}

/**
 * The names the Agent nodes list (connections, CLI tools) that the daemon
 * does not have, with their nodes.
 */
function missingNames(
	nodes: readonly FlowNode[],
	listed: (node: AgentNode) => readonly string[],
	names: ReadonlySet<string>,
): { name: string; nodeIds: string[] }[] {
	const missing = new Map<string, string[]>();
	for (const node of nodes) {
		if (node.type !== "agent") continue;
		for (const name of listed(node)) {
			if (names.has(name)) continue;
			const ids = missing.get(name) ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			missing.set(name, ids);
		}
	}
	return [...missing].map(([name, nodeIds]) => ({ name, nodeIds }));
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

/** The names of the flows a flow's Subflow and For Each nodes call. */
function calledFlowNames(flow: Flow): string[] {
	return flow.nodes.flatMap((n) =>
		n.type === "foreach" || n.type === "subflow" ? [n.flow] : [],
	);
}

/**
 * A flow from a run's snapshot, in today's format: version 1 snapshots
 * migrate, and defaults apply. A snapshot that no longer parses is used as
 * it is, so an old run still shows.
 */
function snapshotFlow(json: unknown): Flow {
	const migrated = migrateFlow(json);
	const parsed = flowSchema.safeParse(migrated);
	return parsed.success ? parsed.data : (migrated as Flow);
}
