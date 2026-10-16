import { MemorySaver } from "@langchain/langgraph";
import type { AgentHarness } from "@nightshift/agents";
import { project, run } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type CommandNode,
	type Flow,
	type FlowEdge,
	type FlowInput,
	flowSchema,
} from "@nightshift/flows";
import { eq } from "drizzle-orm";

import { createRunBus } from "../bus";
import type { EngineEventType, EnginePayloads, LoggedEvent } from "../events";
import { createRunLog, type RunLog } from "../run-log";
import { defaultRunSettings } from "../settings";
import type { Sandbox } from "../test-support";
import { compileFlow } from "./compile";
import { createRecorders, type StepContext } from "./context";
import type { Parked, RunEvent, RunStateValues } from "./state";

/**
 * Drives one compiled flow (with its called flows) on a MemorySaver over
 * the sandbox's database and git repository, as agent-node.test.ts does:
 * a run row, a log with `RunStarted`, a minimal StepContext and a stream
 * collector for the root's interrupts and the custom events.
 */

export const agent = (
	id: string,
	prompt: string,
	extra: Partial<AgentNode> = {},
): AgentNode => ({
	id,
	type: "agent",
	position: { x: 0, y: 0 },
	prompt,
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	session: "fresh",
	...extra,
});

export const command = (id: string, cmd: string): CommandNode => ({
	id,
	type: "command",
	position: { x: 0, y: 0 },
	command: cmd,
});

export const edge = (
	id: string,
	from: string,
	outcome: FlowEdge["outcome"],
	to: string,
): FlowEdge => ({ id, from, outcome, to });

export const flowOf = (
	nodes: FlowInput["nodes"],
	edges: FlowEdge[] = [],
	extra: Partial<Omit<FlowInput, "version">> = {},
): Flow =>
	flowSchema.parse({
		version: 3,
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
		...extra,
	});

export type Harness = {
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
	harness: AgentHarness,
	options: {
		flows?: Record<string, Flow>;
		signal?: AbortSignal;
		inputs?: Record<string, string>;
		branch?: string;
	} = {},
): Promise<Harness> {
	const { db } = sandbox;
	const runId = `run-${++runs}`;
	const projectId = "project-1";
	const flows = options.flows ?? {};
	const branch = options.branch ?? "nightshift/test";
	await db
		.insert(project)
		.values({ id: projectId, name: "repo", repoPath: sandbox.repoPath })
		.onConflictDoNothing();
	await db.insert(run).values({
		id: runId,
		projectId,
		flowName: null,
		flow: JSON.stringify(flow),
		bodyFlows: JSON.stringify(flows),
		title: "test",
		worktreePath: sandbox.repoPath,
		branch,
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
			inputs: options.inputs ?? {},
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
		flows,
		policy: () => ({
			usageLimitFirstWaitMinutes: 5,
			usageLimitMaxWaitMinutes: 60,
			networkGraceMinutes: 240,
		}),
		log,
		bus,
		recorder: (stepId, path) => recorders.open(runId, stepId, path),
		harnessFor: (name) => (name === "claude-code" ? harness : undefined),
		mcpServersFor: async () => ({ ok: true, servers: {} }),
		signal: () => options.signal ?? controller.signal,
		now: Date.now,
		minuteMs: 1_000,
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
	/** The root's interrupts, innermost value first. */
	parked: Parked[];
	events: RunEvent[];
	state: RunStateValues;
	next: string[];
};

/** Streams the graph and collects the root's interrupts and the custom events. */
export async function drive(
	h: Harness,
	input: Parameters<ReturnType<Harness["graph"]>["stream"]>[0],
	graph = h.graph(),
): Promise<Driven> {
	const parked: Parked[] = [];
	const events: RunEvent[] = [];
	const stream = await graph.stream(input, {
		...h.config,
		streamMode: ["updates", "custom"],
		subgraphs: true,
		durability: "sync",
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
