import type { Command, LangGraphRunnableConfig } from "@langchain/langgraph";
import { HARNESS_LABELS } from "@nightshift/agents/harness-facts";
import type {
	AgentErrorKind,
	AgentHarness,
	Decider,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { run, step } from "@nightshift/db/schema/nightshift";
import type {
	AgentNode,
	Flow,
	FlowNode,
	ResolvedPolicy,
	TemplateContext,
} from "@nightshift/flows";
import { eq } from "drizzle-orm";

import type { RunBus } from "../bus";
import type { CliToolGuide } from "../cli-tools";
import type { PolicyWaitReason } from "../events";
import type { McpExpansion } from "../mcp";
import type { RunLog } from "../run-log";
import type { RunSettings } from "../settings";
import { openTranscriptWriter, readRunTranscript } from "../transcripts";
import type { StepEvent, TranscriptEntry } from "../types";
import type { RunEvent, RunStateValues } from "./state";

/**
 * What every node factory gets (`StepContext`), the transcript recorders,
 * the template context and the stop time as a graph sees it. The step
 * lifecycle itself (the entry checks, the `step` row,
 * `StepStarted`/`StepReopened`/`StepEnded`, the timers, the abort
 * translation, the routing) is the step runner's (`graph/step-runner.ts`);
 * a step's sleep and wake are the sleep module's (`graph/sleep.ts`). The
 * log is written exactly as the old engine wrote it.
 */

export type RunRow = typeof run.$inferSelect;

/** The run's row, or an error naming the run. */
export async function getRunRow(db: Database, runId: string): Promise<RunRow> {
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error(`Run not found: ${runId}`);
	return row;
}

/**
 * Harness display names by name, for a message about a harness that is not
 * added (no `AgentHarness` instance to ask). Sourced from the port side
 * (`harness-facts.ts`), not the adapter registry.
 */
export const HARNESS_LABEL: Record<HarnessName, string> = HARNESS_LABELS;

/** A harness or decider error the run policy waits out, rather than a failure. */
export const isWaitKind = (
	kind: AgentErrorKind | null | undefined,
): kind is PolicyWaitReason => kind === "usage-limit" || kind === "network";

export const DEFAULT_RESUME_PROMPT = "Continue where you left off.";
export const STOP_TIME_REASON = "Reached the stop time";
export const STOP_AFTER_STEP_REASON =
	"Stopped after the running step, as asked.";
/** How long a stopped harness may take to end its stream. */
export const STOP_GRACE_MS = 5_000;

/** A step's transcript writer. Each entry is on disk, then on the bus, then returned. */
export type Recorder = {
	record(sessionId: string | null, event: StepEvent): TranscriptEntry;
	close(): void;
};

/**
 * What a node factory gets. One per run and per compiled flow: a Call
 * node compiles its called flow with `flow` and `flowName`
 * replaced, everything else shared. Per-invocation facts (the scope, the
 * element's `run` template fields) travel in `config.configurable`:
 *
 * - `configurable.scope: Scope | null`: the calling step and element, null
 *   at the top level. Body nodes stamp it on their events (design rule 6).
 * - `configurable.run?: { branch, base_branch, index }`: the `{{run.*}}`
 *   fields of a Call element (`each`); absent at the top level.
 */
export type StepContext = {
	db: Database;
	/** The run: id, project, worktree, branch, base ref, flow snapshots. */
	run: RunRow;
	/** The flow this graph was compiled from. */
	flow: Flow;
	/** `{{run.flow}}`: the flow's file name, or the run's title for a quick run. */
	flowName: string;
	/** The run's called flows by name (the bodies of Call nodes). */
	flows: Record<string, Flow>;
	/**
	 * The run's policy, resolved at each use like `settings()`: a thread
	 * that stays compiled across a settings change (a run at a Gate for
	 * days, or asleep) plans its waits and checks the step cap with the
	 * current numbers, in bodies too.
	 */
	policy(): ResolvedPolicy;
	/** `append` writes a fact; `events(runId)` reads the log for lookups. */
	log: RunLog;
	bus: RunBus;
	/** Opens a step's transcript for appending; `seq` continues the run's count. */
	recorder(stepId: string, path: string): Promise<Recorder>;
	/** The harness of that name, when it is added and built. */
	harnessFor(name: HarnessName): AgentHarness | undefined;
	decider?: Decider;
	/** An Agent node's MCP servers, expanded. The values go to the harness only. */
	mcpServersFor(
		node: Pick<AgentNode, "connections" | "mcpServers">,
	): Promise<McpExpansion>;
	/** What an agent learns about its CLI tools. Without it: nothing. */
	cliToolsFor?: (names: readonly string[]) => Promise<CliToolGuide[]>;
	/** The run's abort signal: a person stopped the run. */
	signal(): AbortSignal;
	now(): number;
	/** How long one minute of a timeout or a policy wait lasts. 60 000 in production. */
	minuteMs: number;
	dataDir: string;
	settings(): RunSettings;
};

/** A node of the compiled graph: runs one visit and returns where to go next. */
export type NodeAction = (
	state: RunStateValues,
	config: LangGraphRunnableConfig,
) => Promise<Command>;

/** A node factory: what `compileFlow` registers for a flow node. */
export type NodeFactory<N extends FlowNode = FlowNode> = (
	node: N,
	ctx: StepContext,
) => NodeAction;

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Transcript recorders with one seq counter per run, shared by every step
 * of the run (ported from `openRecorder` and `lastSeqOf`). The runner makes
 * one per daemon and binds `StepContext.recorder` to the run.
 */
export function createRecorders(input: { db: Database; bus: RunBus }) {
	const { db, bus } = input;
	/** The last transcript seq written per run. Loaded from disk on first use. */
	const lastSeqs = new Map<string, number>();

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

	return {
		async open(runId: string, stepId: string, path: string): Promise<Recorder> {
			await lastSeqOf(runId);
			const writer = openTranscriptWriter(path);
			return {
				record(sessionId, stepEvent) {
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
					return entry;
				},
				close: () => writer.close(),
			};
		},
	};
}

/** Templates of a node read the state's node outputs, the inputs and the run. */
export function templateContext(
	ctx: StepContext,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): TemplateContext {
	const fields = (config.configurable?.run as
		| { branch: string; base_branch: string; index: string }
		| undefined) ?? { branch: ctx.run.branch, base_branch: "", index: "" };
	return {
		nodes: state.nodes,
		inputs: state.inputs,
		run: {
			...fields,
			worktree: ctx.run.worktreePath,
			base_ref: ctx.run.baseRef,
			flow: ctx.flowName,
		},
	};
}

/** Writes to LangGraph's `custom` stream, when the run is streamed. */
export function emit(config: LangGraphRunnableConfig, event: RunEvent): void {
	config.writer?.(event);
}

/**
 * The run's stop time as this graph sees it (epoch ms, or null). The root
 * reads its state; a body reads its caller's, which `runBody` puts in
 * `configurable.stopAt` on every invoke, so a stop time a resume cleared
 * at the root reaches a body that resumes from its own checkpoint. None
 * while the graph wraps the run up after a `stopped` edge (`wrappingUp`).
 */
export function stopAtOf(
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): number | null {
	if (state.wrappingUp) return null;
	const own = config.configurable?.stopAt as number | null | undefined;
	return own === undefined ? state.stopAt : own;
}

/** True when the run has a stop time and it has passed. */
export function pastStopTime(
	ctx: StepContext,
	state: RunStateValues,
	config: LangGraphRunnableConfig,
): boolean {
	const stopAt = stopAtOf(state, config);
	return stopAt !== null && ctx.now() >= stopAt;
}
