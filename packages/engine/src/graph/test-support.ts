import { MemorySaver } from "@langchain/langgraph";
import type { AgentHarness, Decider } from "@nightshift/agents/types";
import { project, run } from "@nightshift/db/schema/nightshift";
import { type Flow, type FlowInput, flowSchema } from "@nightshift/flows";
import { eq } from "drizzle-orm";

import { createRunBus } from "../bus";
import type { EngineEventType, EnginePayloads, LoggedEvent } from "../events";
import { createRunLog, type RunLog } from "../run-log";
import { defaultRunSettings } from "../settings";
import type { Sandbox } from "../test-support";
import { compileFlow } from "./compile";
import {
	createEffectJournal,
	createRecorders,
	type StepContext,
} from "./context";
import type { Parked, RunEvent, RunStateValues } from "./state";

/**
 * Test helpers for the graph nodes: a run row with its log, a minimal
 * StepContext, a compiled graph over a MemorySaver, and a driver that
 * streams the graph and collects the root's interrupts and the custom
 * events. The same shape as agent-node.test.ts uses.
 */

export const flowOf = (input: Omit<FlowInput, "version">): Flow =>
	flowSchema.parse({ version: 2, ...input });

/** How long one minute of a timeout or a policy wait lasts in these tests. */
export const MINUTE = 1_000;

export type GraphHarness = {
	ctx: StepContext;
	log: RunLog;
	runId: string;
	saver: MemorySaver;
	config: { configurable: { thread_id: string } };
	/** Compiles the flow again over the same saver: a new daemon. */
	graph(): ReturnType<ReturnType<typeof compileFlow>["compile"]>;
	events(): Promise<LoggedEvent[]>;
	types(): Promise<string[]>;
};

let runs = 0;

/** A run row, its log with `RunStarted`, and a minimal StepContext. */
export async function startRun(
	sandbox: Sandbox,
	flow: Flow,
	options: {
		harness?: AgentHarness;
		decider?: Decider;
		signal?: AbortSignal;
		inputs?: Record<string, string>;
	} = {},
): Promise<GraphHarness> {
	const { db } = sandbox;
	const runId = `run-${++runs}`;
	const projectId = "project-1";
	await db
		.insert(project)
		.values({ id: projectId, name: "repo", repoPath: sandbox.repoPath })
		.onConflictDoNothing();
	await db.insert(run).values({
		id: runId,
		projectId,
		flowName: null,
		flow: JSON.stringify(flow),
		bodyFlows: "{}",
		title: "test",
		worktreePath: sandbox.repoPath,
		branch: "nightshift/test",
		baseRef: "main",
	});
	const log = createRunLog(db);
	await log.append({
		type: "RunStarted",
		runId,
		payload: {
			projectId,
			flowName: null,
			title: "test",
			start: flow.start,
			inputs: options.inputs ?? { task: "the thing" },
		},
	});
	const bus = createRunBus();
	const recorders = createRecorders({ db, bus });
	const controller = new AbortController();
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error("no run row");
	const ctx: StepContext = {
		db,
		run: row,
		flow,
		flowName: "test",
		flows: {},
		policy: () => ({
			usageLimitFirstWaitMinutes: 5,
			usageLimitMaxWaitMinutes: 60,
			networkGraceMinutes: 240,
		}),
		log,
		bus,
		recorder: (stepId, path) => recorders.open(runId, stepId, path),
		harnessFor: (name) =>
			name === "claude-code" ? options.harness : undefined,
		...(options.decider ? { decider: options.decider } : {}),
		mcpServersFor: async () => ({ ok: true, servers: {} }),
		effectJournal: (id, stepId) => createEffectJournal(log, id, stepId),
		signal: () => options.signal ?? controller.signal,
		now: Date.now,
		minuteMs: MINUTE,
		dataDir: sandbox.dataDir,
		settings: defaultRunSettings,
	};
	const saver = new MemorySaver();
	return {
		ctx,
		log,
		runId,
		saver,
		config: { configurable: { thread_id: runId } },
		graph: () => compileFlow(flow, ctx).compile({ checkpointer: saver }),
		events: () => log.events(runId),
		types: async () => (await log.events(runId)).map((e) => e.type),
	};
}

export type Driven = {
	parked: Parked[];
	events: RunEvent[];
	state: RunStateValues;
	next: string[];
};

/** Streams the graph and collects the root's interrupts and the custom events. */
export async function drive(
	h: GraphHarness,
	input: Parameters<ReturnType<GraphHarness["graph"]>["stream"]>[0],
	graph = h.graph(),
): Promise<Driven> {
	const parked: Parked[] = [];
	const events: RunEvent[] = [];
	const stream = await graph.stream(input, {
		...h.config,
		streamMode: ["updates", "custom"],
		subgraphs: true,
	});
	for await (const chunk of stream) {
		const [namespace, mode, data] = chunk as [string[], string, unknown];
		if (mode === "custom") {
			events.push(data as RunEvent);
			continue;
		}
		for (const [node, update] of Object.entries(
			data as Record<string, unknown>,
		)) {
			if (node !== "__interrupt__" || namespace.length > 0) continue;
			const [first] = update as { value: Parked }[];
			if (first) parked.push(first.value);
		}
	}
	const snapshot = await graph.getState(h.config);
	return {
		parked,
		events,
		state: snapshot.values as RunStateValues,
		next: [...snapshot.next],
	};
}

export const payloads = <T extends EngineEventType>(
	events: LoggedEvent[],
	type: T,
): EnginePayloads[T][] =>
	events
		.filter((e) => e.type === type)
		.map((e) => e.payload as EnginePayloads[T]);
