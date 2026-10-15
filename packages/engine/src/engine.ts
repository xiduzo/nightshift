import { randomUUID } from "node:crypto";
import type {
	AgentEvent,
	AgentHarness,
	HarnessName,
	StepReportOutcome,
} from "@nightshift/agents/types";
import {
	agentSession,
	event,
	project,
	run,
	step,
} from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type CommandNode,
	type Flow,
	type FlowIssue,
	type FlowNode,
	nextEdge,
	parseFlow,
	renderCommand,
	renderTemplate,
	type TemplateContext,
	validateFlow,
} from "@nightshift/flows";
import {
	deleteFlowFile,
	listFlowFiles,
	readFlowFile,
	writeFlowFile,
} from "@nightshift/flows/files";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { createRunBus } from "./bus";
import { runCommand } from "./command";
import { consumeStream } from "./consume";
import {
	appendEvent,
	countStepsSinceWalkBegan,
	countVisits,
	type DerivedStep,
	deriveNodeOutputs,
	deriveResumePoint,
	deriveRunState,
	deriveSteps,
	deriveTraversals,
	type EngineEventType,
	type EnginePayloads,
	groupByRun,
	type LoggedEvent,
	lastHarnessSession,
	lastHarnessSessionOfNode,
	openWork,
	parseEventRow,
	type RunEnding,
	type StepOutputs,
	sumCostUsd,
} from "./events";
import {
	commandLogPath,
	openTranscriptWriter,
	readRunTranscript,
	transcriptPath,
} from "./transcripts";
import type {
	Engine,
	EngineOptions,
	Project,
	RunDetail,
	RunStatus,
	RunStreamItem,
	RunSummary,
	StartRunInput,
	StepEvent,
	StepOutcome,
	StepSummary,
	TranscriptEntry,
} from "./types";
import { createWorktree, resolveRepoTopLevel } from "./worktrees";

const DEFAULT_MAX_CONCURRENT_RUNS = 2;
const DEFAULT_MAX_STEPS_PER_RUN = 50;
/** How long a stopped harness may take to end its stream. */
const STOP_GRACE_MS = 5_000;
const DEFAULT_RESUME_PROMPT = "Continue where you left off.";
const TITLE_MAX_CHARS = 80;
const QUICK_RUN_TITLE = "Quick run";

/** The CLI a person runs to take over a harness session. */
const takeOverCli: Record<HarnessName, string> = {
	"claude-code": "claude",
};

type RunRow = typeof run.$inferSelect;
type SessionEnding = EnginePayloads["SessionEnded"];

/** Why a step's signal aborted. */
type AbortReason = "stopped" | "timeout";

type ActiveWalk = {
	/** Aborts when a person stops the run. */
	controller: AbortController;
	done: Promise<void>;
};

/** A slot is reserved before any await, so two calls cannot both pass the cap. */
type Slot = ActiveWalk | "starting";

/** Where a walk begins. */
type WalkStart =
	| { kind: "node"; nodeId: string }
	| {
			kind: "session";
			stepId: string;
			nodeId: string;
			harnessSessionId: string;
			prompt: string;
	  };

type StepResult = {
	outcome: StepOutcome;
	outputs: StepOutputs;
	error: string | null;
};

type RunContext = {
	row: RunRow;
	flow: Flow;
	walk: ActiveWalk;
};

/** Knobs for tests only. Not part of the engine contract. */
export type EngineInternals = {
	/** How long one minute of a node's `timeoutMinutes` lasts. Default 60 000 ms. */
	minuteMs?: number;
};

/** Event types that open or close work. Recovery reads only these. */
const LIFECYCLE_EVENT_TYPES = [
	"RunStarted",
	"RunResumed",
	"RunEnded",
	"StepStarted",
	"StepReopened",
	"StepEnded",
	"SessionStarted",
	"SessionEnded",
] as const satisfies readonly EngineEventType[];

export function createEngine(
	options: EngineOptions,
	internals: EngineInternals = {},
): Engine {
	const minuteMs = internals.minuteMs ?? 60_000;
	const { db, harnesses, dataDir } = options;
	const maxConcurrentRuns =
		options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
	if (!Number.isInteger(maxConcurrentRuns) || maxConcurrentRuns < 1) {
		throw new Error("maxConcurrentRuns must be a positive integer.");
	}
	const maxStepsPerRun = options.maxStepsPerRun ?? DEFAULT_MAX_STEPS_PER_RUN;
	if (!Number.isInteger(maxStepsPerRun) || maxStepsPerRun < 1) {
		throw new Error("maxStepsPerRun must be a positive integer.");
	}

	const bus = createRunBus();
	/** Keyed by run id: the runs that walk in this process. */
	const slots = new Map<string, Slot>();
	/** The last transcript seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();

	const ready = recoverInterruptedWork();
	// Every method awaits `ready` and sees the error there.
	ready.catch(() => {});

	/**
	 * A daemon that died left sessions, steps and runs open. They become
	 * `interrupted`. Nothing continues on its own: a person resumes.
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
		const error = "The daemon stopped while this ran.";
		for (const [runId, events] of byRun) {
			const open = openWork(events);
			for (const session of open.sessions) {
				await appendEvent(db, {
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
				await appendEvent(db, {
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
				await appendEvent(db, {
					type: "RunEnded",
					runId,
					payload: {
						status: "interrupted",
						reason: "The daemon stopped while this run ran.",
					},
				});
			}
		}
	}

	function reserveSlot(runId: string): void {
		if (slots.has(runId)) {
			throw new Error(
				"This run is still running. Stop it or wait for it to end.",
			);
		}
		if (slots.size >= maxConcurrentRuns) {
			throw new Error(
				`The run cap is reached: ${slots.size} of ${maxConcurrentRuns} runs are running. Stop a run or wait for one to end.`,
			);
		}
		slots.set(runId, "starting");
	}

	function releaseStartingSlot(runId: string): void {
		if (slots.get(runId) === "starting") slots.delete(runId);
	}

	async function getRunRow(runId: string): Promise<RunRow> {
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		if (!row) throw new Error(`Run not found: ${runId}`);
		return row;
	}

	/** A project that a person has not removed. */
	async function getProjectRow(projectId: string) {
		const [row] = await db
			.select()
			.from(project)
			.where(and(eq(project.id, projectId), isNull(project.removedAt)));
		if (!row) throw new Error(`Project not found: ${projectId}`);
		return row;
	}

	async function loadRunEvents(runId: string): Promise<LoggedEvent[]> {
		const rows = await db
			.select()
			.from(event)
			.where(eq(event.runId, runId))
			.orderBy(asc(event.seq));
		return rows.map(parseEventRow);
	}

	async function loadEventsByRun(
		runIds: readonly string[],
	): Promise<Map<string, LoggedEvent[]>> {
		if (runIds.length === 0) return new Map();
		const rows = await db
			.select()
			.from(event)
			.where(inArray(event.runId, [...runIds]))
			.orderBy(asc(event.seq));
		return groupByRun(rows.map(parseEventRow));
	}

	function parseRunFlow(row: RunRow): Flow {
		return JSON.parse(row.flow) as Flow;
	}

	function toSummary(row: RunRow, events: readonly LoggedEvent[]): RunSummary {
		const state = deriveRunState(events);
		return {
			id: row.id,
			projectId: row.projectId,
			flowName: row.flowName,
			title: row.title,
			worktreePath: row.worktreePath,
			branch: row.branch,
			baseRef: row.baseRef,
			status: state.status,
			reason: state.reason,
			createdAt: row.createdAt.getTime(),
			costUsd: sumCostUsd(events),
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
		};
	}

	async function lastSeqOf(runId: string): Promise<number> {
		const known = lastSeqs.get(runId);
		if (known !== undefined) return known;
		const rows = await db
			.select({ transcriptPath: step.transcriptPath })
			.from(step)
			.where(eq(step.runId, runId));
		const entries = await readRunTranscript(rows.map((r) => r.transcriptPath));
		const last = entries.at(-1)?.seq ?? 0;
		// A step of this run may have written meanwhile; keep the larger.
		const current = Math.max(last, lastSeqs.get(runId) ?? 0);
		lastSeqs.set(runId, current);
		return current;
	}

	function templateContext(
		row: RunRow,
		events: readonly LoggedEvent[],
	): TemplateContext {
		return {
			nodes: deriveNodeOutputs(events),
			run: {
				branch: row.branch,
				worktree: row.worktreePath,
				base_ref: row.baseRef,
				flow: row.flowName ?? row.title,
			},
		};
	}

	async function endRun(
		runId: string,
		status: RunEnding,
		reason: string | null,
	): Promise<void> {
		try {
			await appendEvent(db, {
				type: "RunEnded",
				runId,
				payload: { status, reason },
			});
		} catch (error) {
			// The next start marks the run interrupted.
			console.error(`[engine] could not record the end of run ${runId}`, error);
		}
	}

	/**
	 * Takes over a reserved slot and walks the flow in the background. The
	 * slot is released when the walk ends, however it ends.
	 */
	function launchWalk(row: RunRow, flow: Flow, start: WalkStart): void {
		const walk: ActiveWalk = {
			controller: new AbortController(),
			done: Promise.resolve(),
		};
		slots.set(row.id, walk);
		bus.publish(row.id, { kind: "status-changed" });
		walk.done = walkFlow({ row, flow, walk }, start).finally(() => {
			if (slots.get(row.id) === walk) slots.delete(row.id);
			bus.publish(row.id, { kind: "status-changed" });
		});
	}

	/**
	 * The graph walk: one step at a time. Every step is closed in the log
	 * before the next edge is chosen, and every choice reads the log again,
	 * so the log alone is enough to continue after a stop or a crash.
	 */
	async function walkFlow(ctx: RunContext, start: WalkStart): Promise<void> {
		const runId = ctx.row.id;
		const signal = ctx.walk.controller.signal;
		let next: WalkStart = start;
		try {
			while (true) {
				if (signal.aborted) {
					await endRun(runId, "stopped", null);
					return;
				}
				const events = await loadRunEvents(runId);
				if (
					next.kind === "node" &&
					countStepsSinceWalkBegan(events) >= maxStepsPerRun
				) {
					await endRun(
						runId,
						"failed",
						`The run reached the limit of ${maxStepsPerRun} steps before node "${next.nodeId}". Resume it to continue.`,
					);
					return;
				}
				const nodeId = next.nodeId;
				const node = ctx.flow.nodes.find((n) => n.id === nodeId);
				if (!node) {
					await endRun(runId, "failed", `The flow has no node "${nodeId}".`);
					return;
				}

				if (signal.aborted) {
					await endRun(runId, "stopped", null);
					return;
				}
				const result = await runStep(ctx, node, next, events);
				if (result.outcome === "stopped") {
					await endRun(runId, "stopped", null);
					return;
				}
				if (result.outcome === "error" || result.outcome === "interrupted") {
					await endRun(
						runId,
						"failed",
						`Node "${node.id}" failed: ${result.error ?? "unknown error"}`,
					);
					return;
				}

				const outcome = result.outcome;
				const traversals = deriveTraversals(await loadRunEvents(runId));
				const choice = nextEdge({
					flow: ctx.flow,
					from: node.id,
					outcome,
					traversals,
				});
				if (choice.kind === "end") {
					if (outcome === "pass") await endRun(runId, "finished", null);
					else {
						await endRun(
							runId,
							"failed",
							`Node "${node.id}" ended with "${outcome}" and no edge leaves it on that outcome.`,
						);
					}
					return;
				}
				if (choice.kind === "exhausted") {
					const edges = choice.edges
						.map(
							(e) =>
								`"${e.id}" (${e.from} → ${e.to} on ${e.outcome}, max ${e.max ?? "∞"})`,
						)
						.join(", ");
					await endRun(
						runId,
						"failed",
						`Node "${node.id}" ended with "${outcome}", but edge ${edges} reached its max.`,
					);
					return;
				}
				const { edge } = choice;
				await appendEvent(db, {
					type: "EdgeTaken",
					runId,
					payload: {
						edgeId: edge.id,
						from: edge.from,
						to: edge.to,
						outcome,
					},
				});
				next = { kind: "node", nodeId: edge.to };
			}
		} catch (error) {
			console.error(`[engine] the walk of run ${runId} failed`, error);
			await endRun(runId, "failed", `The engine failed: ${messageOf(error)}`);
		}
	}

	/** Runs one visit of a node (or reopens an Agent step) and closes it in the log. */
	async function runStep(
		ctx: RunContext,
		node: FlowNode,
		start: WalkStart,
		events: readonly LoggedEvent[],
	): Promise<StepResult> {
		const runId = ctx.row.id;
		let stepId: string;
		let path: string;
		let visit: number;

		if (start.kind === "session") {
			const existing = deriveSteps(events).find((s) => s.id === start.stepId);
			if (!existing) throw new Error(`Step not found: ${start.stepId}`);
			stepId = existing.id;
			path = existing.transcriptPath;
			visit = existing.visit;
			await appendEvent(db, {
				type: "StepReopened",
				runId,
				stepId,
				payload: { prompt: start.prompt },
			});
		} else {
			stepId = randomUUID();
			path = transcriptPath(dataDir, runId, stepId);
			visit = countVisits(events, node.id) + 1;
			const logPath =
				node.type === "command" ? commandLogPath(dataDir, runId, stepId) : null;
			await db.insert(step).values({
				id: stepId,
				runId,
				nodeId: node.id,
				nodeType: node.type,
				visit,
				transcriptPath: path,
			});
			await appendEvent(db, {
				type: "StepStarted",
				runId,
				stepId,
				payload: {
					nodeId: node.id,
					nodeType: node.type,
					visit,
					transcriptPath: path,
					logPath,
				},
			});
		}
		bus.publish(runId, { kind: "step-changed", stepId });

		// The step's own signal: a stop of the run or the node's time budget.
		const stepController = new AbortController();
		const runSignal = ctx.walk.controller.signal;
		const onStop = () => stepController.abort("stopped" satisfies AbortReason);
		if (runSignal.aborted) onStop();
		else runSignal.addEventListener("abort", onStop, { once: true });
		const timer = node.timeoutMinutes
			? setTimeout(
					() => stepController.abort("timeout" satisfies AbortReason),
					node.timeoutMinutes * minuteMs,
				)
			: undefined;

		await lastSeqOf(runId);
		const writer = openTranscriptWriter(path);
		const record = (sessionId: string | null, stepEvent: StepEvent): void => {
			const seq = (lastSeqs.get(runId) ?? 0) + 1;
			lastSeqs.set(runId, seq);
			const entry: TranscriptEntry = {
				seq,
				stepId,
				sessionId,
				at: Date.now(),
				event: stepEvent,
			};
			// On disk first, then on the bus: watchRun depends on this order.
			writer.append(entry);
			bus.publish(runId, { kind: "transcript", entry });
		};

		const timeoutError = `The step ran past its time budget of ${node.timeoutMinutes} min.`;
		const abortResult = (outputs: StepOutputs): StepResult | null => {
			if (!stepController.signal.aborted) return null;
			const reason = stepController.signal.reason as AbortReason;
			if (reason === "timeout") {
				return {
					outcome: "error",
					outputs: { ...outputs, outcome: "error" },
					error: timeoutError,
				};
			}
			return {
				outcome: "stopped",
				outputs: { ...outputs, outcome: "stopped" },
				error: null,
			};
		};

		let result: StepResult;
		try {
			const tctx = templateContext(ctx.row, events);
			if (node.type === "agent") {
				result = await runAgentStep({
					row: ctx.row,
					node,
					stepId,
					visit,
					start,
					events,
					tctx,
					signal: stepController.signal,
					record,
					abortResult,
				});
			} else {
				result = await runCommandStep({
					row: ctx.row,
					node,
					stepId,
					visit,
					tctx,
					signal: stepController.signal,
					record,
					abortResult,
				});
			}
		} catch (error) {
			result = {
				outcome: "error",
				outputs: { outcome: "error", visit },
				error: messageOf(error),
			};
		} finally {
			writer.close();
			clearTimeout(timer);
			runSignal.removeEventListener("abort", onStop);
		}

		await appendEvent(db, {
			type: "StepEnded",
			runId,
			stepId,
			payload: result,
		});
		bus.publish(runId, { kind: "step-changed", stepId });
		return result;
	}

	type StepRunInput = {
		row: RunRow;
		stepId: string;
		visit: number;
		tctx: TemplateContext;
		signal: AbortSignal;
		record: (sessionId: string | null, stepEvent: StepEvent) => void;
		abortResult: (outputs: StepOutputs) => StepResult | null;
	};

	async function runAgentStep(
		input: StepRunInput & {
			node: AgentNode;
			start: WalkStart;
			events: readonly LoggedEvent[];
		},
	): Promise<StepResult> {
		const { row, node, stepId, visit, start, events, signal, record } = input;
		const runId = row.id;

		let prompt: string;
		let resumeSessionId: string | null;
		if (start.kind === "session") {
			prompt = start.prompt;
			resumeSessionId = start.harnessSessionId;
		} else {
			const rendered = renderTemplate(node.prompt, input.tctx);
			prompt = node.skill ? `/${node.skill} ${rendered}`.trim() : rendered;
			resumeSessionId =
				node.session === "resume"
					? lastHarnessSessionOfNode(events, node.id)
					: null;
		}

		const harness: AgentHarness | undefined = harnesses[node.harness];
		if (!harness) {
			return {
				outcome: "error",
				outputs: { outcome: "error", visit },
				error: `No harness is configured for "${node.harness}".`,
			};
		}

		const sessionId = randomUUID();
		await db
			.insert(agentSession)
			.values({ id: sessionId, runId, stepId, prompt });
		await appendEvent(db, {
			type: "SessionStarted",
			runId,
			stepId,
			sessionId,
			payload: { prompt, resumeSessionId },
		});
		bus.publish(runId, { kind: "step-changed", stepId });

		let harnessSessionId: string | null = resumeSessionId;
		let ending: SessionEnding | null = null;
		let report: { outcome: StepReportOutcome; summary: string } | null = null;
		/** The text after the last tool call: the agent's final message. */
		let output = "";
		let afterTool = false;
		let lastMessageId: string | null = null;

		const onEvent = async (agentEvent: AgentEvent): Promise<void> => {
			record(sessionId, agentEvent);
			switch (agentEvent.type) {
				case "session":
					harnessSessionId = agentEvent.sessionId;
					await db
						.update(agentSession)
						.set({ harnessSessionId: agentEvent.sessionId })
						.where(eq(agentSession.id, sessionId));
					await appendEvent(db, {
						type: "HarnessSessionAssigned",
						runId,
						stepId,
						sessionId,
						payload: {
							harnessSessionId: agentEvent.sessionId,
							model: agentEvent.model ?? null,
						},
					});
					bus.publish(runId, { kind: "step-changed", stepId });
					break;
				case "text":
					// The output is the last message: a tool call or a new message starts it over.
					if (afterTool || agentEvent.messageId !== lastMessageId) {
						output = "";
						afterTool = false;
						lastMessageId = agentEvent.messageId;
					}
					output += agentEvent.delta;
					break;
				case "tool-start":
				case "tool-end":
				case "tool-result":
					afterTool = true;
					break;
				case "report":
					afterTool = true;
					report = { outcome: agentEvent.outcome, summary: agentEvent.summary };
					break;
				case "finished":
					ending = {
						outcome: "finished",
						error: null,
						errorKind: null,
						usage: agentEvent.usage ?? null,
						costUsd: agentEvent.usage?.costUsd ?? null,
						resetAt: null,
					};
					break;
				case "error":
					ending = {
						outcome:
							signal.aborted && signal.reason === "stopped"
								? "stopped"
								: "failed",
						error: agentEvent.message,
						errorKind: agentEvent.kind,
						usage: null,
						costUsd: null,
						resetAt: agentEvent.resetAt ?? null,
					};
					break;
			}
		};

		const endWithoutResult = (message: string): SessionEnding => ({
			outcome:
				signal.aborted && signal.reason === "stopped" ? "stopped" : "failed",
			error: signal.aborted ? "The session was aborted." : message,
			errorKind: signal.aborted ? "aborted" : "harness",
			usage: null,
			costUsd: null,
			resetAt: null,
		});

		try {
			// A stop that came in while the session was being recorded.
			if (signal.aborted) throw new Error("The session was aborted.");
			const stream = harness.run({
				cwd: row.worktreePath,
				prompt,
				model: node.model,
				permissionMode: node.permissionMode,
				effort: node.effort,
				resumeSessionId: resumeSessionId ?? undefined,
				stepReport: true,
				signal,
			});
			await consumeStream(stream, {
				signal,
				graceMs: STOP_GRACE_MS,
				onItem: onEvent,
				isLast: (e) => e.type === "finished" || e.type === "error",
			});
		} catch (error) {
			ending ??= endWithoutResult(messageOf(error));
		}
		const final: SessionEnding =
			ending ?? endWithoutResult("The harness stream ended without a result.");
		await appendEvent(db, {
			type: "SessionEnded",
			runId,
			stepId,
			sessionId,
			payload: final,
		});

		const finalReport = report as {
			outcome: StepReportOutcome;
			summary: string;
		} | null;
		const outputs: StepOutputs = {
			visit,
			output,
			summary: finalReport?.summary || output,
			session_id: harnessSessionId ?? "",
		};
		const aborted = input.abortResult(outputs);
		if (aborted) return aborted;
		if (finalReport) {
			return {
				outcome: finalReport.outcome,
				outputs: { ...outputs, outcome: finalReport.outcome },
				error: null,
			};
		}
		if (final.outcome === "finished") {
			return {
				outcome: "pass",
				outputs: { ...outputs, outcome: "pass" },
				error: null,
			};
		}
		return {
			outcome: "error",
			outputs: { ...outputs, outcome: "error" },
			error: final.error ?? "The harness failed.",
		};
	}

	async function runCommandStep(
		input: StepRunInput & { node: CommandNode },
	): Promise<StepResult> {
		const { row, node, stepId, visit, signal, record } = input;
		const { command, env } = renderCommand(node.command, input.tctx);
		record(null, { type: "command-start", command });
		const result = await runCommand({
			command,
			cwd: row.worktreePath,
			env,
			logPath: commandLogPath(dataDir, row.id, stepId),
			signal,
			onOutput: (stream, text) =>
				record(null, { type: "command-output", stream, text }),
		});
		record(null, { type: "command-exit", exitCode: result.exitCode });

		const outputs: StepOutputs = { visit, log_tail: result.logTail };
		if (result.exitCode !== null) outputs.exit_code = result.exitCode;
		const aborted = input.abortResult(outputs);
		if (aborted) return aborted;
		if (result.spawnError) {
			return {
				outcome: "error",
				outputs: { ...outputs, outcome: "error" },
				error: `The command could not start: ${result.spawnError}`,
			};
		}
		const outcome = result.exitCode === 0 ? "pass" : "fail";
		return { outcome, outputs: { ...outputs, outcome }, error: null };
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

	function refuseErrors(issues: readonly FlowIssue[]): void {
		const errors = issues.filter((i) => i.severity === "error");
		if (errors.length === 0) return;
		const list = errors.map((e) => `- ${e.message}`).join("\n");
		throw new Error(
			`The flow cannot run. Fix ${errors.length === 1 ? "this error" : `these ${errors.length} errors`} first:\n${list}`,
		);
	}

	/** Loads, parses and validates the flow a run starts from. */
	async function flowForRun(
		repoPath: string,
		input: StartRunInput,
	): Promise<{ flow: Flow; flowName: string | null }> {
		if (input.flowName !== undefined) {
			const loaded = await readFlowFile(repoPath, input.flowName);
			if (!loaded.flow) {
				refuseErrors(loaded.issues);
				throw new Error(`The flow "${input.flowName}" does not parse.`);
			}
			refuseErrors(validateFlow(loaded.flow));
			return { flow: loaded.flow, flowName: input.flowName };
		}
		const parsed = parseFlow(input.flow);
		refuseErrors(parsed.issues);
		if (!parsed.flow) throw new Error("The flow does not parse.");
		return { flow: parsed.flow, flowName: null };
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
				await appendEvent(db, {
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
			await appendEvent(db, {
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
			if (runs.some((r) => slots.has(r.id))) {
				throw new Error(
					"A run of this project is still running. Stop it first.",
				);
			}
			// Runs, events and worktrees stay: a person may still need them.
			await db
				.update(project)
				.set({ removedAt: new Date() })
				.where(eq(project.id, projectId));
			await appendEvent(db, {
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
			const events = await loadEventsByRun(rows.map((r) => r.id));
			return rows.map((row) => toSummary(row, events.get(row.id) ?? []));
		},

		async getRun(runId) {
			await ready;
			const row = await getRunRow(runId);
			const events = await loadRunEvents(runId);
			const harnessSessionId = lastHarnessSession(events);
			const cli = takeOverCli["claude-code"];
			const detail: RunDetail = {
				...toSummary(row, events),
				flow: parseRunFlow(row),
				steps: deriveSteps(events).map(toStepSummary),
				traversals: deriveTraversals(events),
				takeOverCommand: harnessSessionId
					? `cd ${shellQuote(row.worktreePath)} && ${cli} --resume ${shellQuote(harnessSessionId)}`
					: null,
			};
			return detail;
		},

		async startRun(input: StartRunInput) {
			await ready;
			const runId = randomUUID();
			reserveSlot(runId);
			try {
				const projectRow = await getProjectRow(input.projectId);
				const { flow, flowName } = await flowForRun(projectRow.repoPath, input);
				const title = flowName ?? quickRunTitle(flow);
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
						title,
						worktreePath: worktree.worktreePath,
						branch: worktree.branch,
						baseRef: worktree.baseRef,
					})
					.returning();
				if (!row) throw new Error("Could not create the run.");
				await appendEvent(db, {
					type: "RunStarted",
					runId,
					payload: {
						projectId: projectRow.id,
						flowName,
						title,
						start: flow.start,
					},
				});
				await appendEvent(db, {
					type: "WorktreeCreated",
					runId,
					payload: worktree,
				});
				launchWalk(row, flow, { kind: "node", nodeId: flow.start });
				return toSummary(row, await loadRunEvents(runId));
			} finally {
				releaseStartingSlot(runId);
			}
		},

		async stopRun(runId) {
			await ready;
			await getRunRow(runId);
			const slot = slots.get(runId);
			if (!slot || slot === "starting") return;
			if (!slot.controller.signal.aborted) {
				await appendEvent(db, {
					type: "StopRequested",
					runId,
					payload: {},
				});
				slot.controller.abort();
			}
			await slot.done;
		},

		async resumeRun(runId, prompt) {
			await ready;
			reserveSlot(runId);
			try {
				const row = await getRunRow(runId);
				const events = await loadRunEvents(runId);
				if (deriveRunState(events).status === "running") {
					throw new Error(
						"This run is still running. Stop it or wait for it to end.",
					);
				}
				const flow = parseRunFlow(row);
				const point = deriveResumePoint(events);
				const start: WalkStart =
					point?.kind === "session"
						? { ...point, prompt: prompt ?? DEFAULT_RESUME_PROMPT }
						: { kind: "node", nodeId: point?.nodeId ?? flow.start };
				await appendEvent(db, {
					type: "RunResumed",
					runId,
					payload: {
						nodeId: start.nodeId,
						stepId: start.kind === "session" ? start.stepId : null,
						prompt: start.kind === "session" ? start.prompt : null,
					},
				});
				launchWalk(row, flow, start);
			} finally {
				releaseStartingSlot(runId);
			}
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
		let wake: (() => void) | null = null;
		const notify = () => {
			const resolve = wake;
			wake = null;
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
						wake = resolve;
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

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
