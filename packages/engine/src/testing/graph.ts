import type {
	AgentHarness,
	Decider,
	HarnessName,
} from "@nightshift/agents/types";
import { project, run } from "@nightshift/db/schema";
import {
	type AgentNode,
	type CommandNode,
	FLOW_VERSION,
	type Flow,
	type FlowEdge,
	flowSchema,
} from "@nightshift/flows";
import type { FlowInput } from "@nightshift/flows/testing";
import { now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { createArtifactStore } from "../artifacts/store";
import { localDevice } from "../device/local";
import type { Device } from "../device/types";
import { defaultRunSettings } from "../device-config/settings";
import { compileFlow } from "../graph/compile";
import {
	createRecorders,
	type LeaseTaker,
	type ServiceRunner,
	type StepContext,
	type StepShared,
} from "../graph/context";
import { kindOf } from "../graph/node-kinds";
import { createRunner, type Runner, type RunnerDeps } from "../graph/runner";
import {
	heldOf,
	type Parked,
	type Pending,
	type PendingValue,
	type RunEvent,
	type RunStateValues,
} from "../graph/state";
import {
	type DriveOutcome,
	driveGraph,
	openThread,
	type RunGraph,
	type StreamInput,
	type Thread,
	type ThreadDeps,
} from "../graph/thread";
import { createRunBus } from "../log/bus";
import type {
	EngineEventType,
	EnginePayloads,
	InputValues,
	LoggedEvent,
} from "../log/events";
import { createRunLog, type RunLog } from "../log/run-log";
import type { PlacedRun } from "../log/run-row";
import { readMemory } from "../memory";
import { createPlacement } from "../placement/placement";
import { gitAuthorOf } from "../read/people";
import { parseCalledFlows, parseRunFlow } from "../read/read-model";
import { keptValues } from "../variables/kept";
import {
	connectionsOf,
	type Sandbox,
	TEST_DEVICE_ID,
	type TestDeviceDeps,
} from "./test-support";

/**
 * The one set of helpers for a test that drives a compiled flow (with its
 * called flows) over the sandbox's database and git repository: node
 * builders, a run row with its log and its Thread (`openThread`, as the
 * runner opens it: the same StepContext, fence and checkpoint saver), and
 * a driver that runs the runner's stream loop (`driveGraph`) and collects
 * the root's interrupts and the custom events. `testRunner` is a real
 * runner over the same database, log and Device.
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

export const command = (
	id: string,
	cmd: string,
	extra: Partial<CommandNode> = {},
): CommandNode => ({
	id,
	type: "command",
	position: { x: 0, y: 0 },
	command: cmd,
	stdout: "text",
	...extra,
});

export const edge = (
	id: string,
	from: string,
	outcome: FlowEdge["outcome"],
	to: string,
): FlowEdge => ({ id, from, outcome, to });

type FlowFields = Omit<FlowInput, "version">;

/**
 * A flow at today's version: either the whole input, or its nodes (the
 * first one starts the flow), its edges and the rest.
 */
export function flowOf(input: FlowFields): Flow;
export function flowOf(
	nodes: FlowInput["nodes"],
	edges?: FlowEdge[],
	extra?: Partial<FlowFields>,
): Flow;
export function flowOf(
	input: FlowFields | FlowInput["nodes"],
	edges: FlowEdge[] = [],
	extra: Partial<FlowFields> = {},
): Flow {
	if (Array.isArray(input)) {
		return flowSchema.parse({
			version: FLOW_VERSION,
			start: input[0]?.id ?? "",
			nodes: input,
			edges,
			...extra,
		});
	}
	return flowSchema.parse({ version: FLOW_VERSION, ...input });
}

/** How long one minute of a timeout or a policy wait lasts in these tests. */
export const MINUTE = 1_000;

export type Harness = {
	/** The thread's StepContext. A test may swap a field of it: the graph reads it at each use. */
	ctx: StepContext;
	/**
	 * What the run's Device is made of, read at each step: a test changes
	 * it between steps (a harness removed, a connection that fails).
	 */
	local: TestDeviceDeps;
	/** The run log, not fenced: a test writes the runner's part with it. */
	log: RunLog;
	runId: string;
	/** The run's Thread, opened as the runner opens it. */
	thread: Thread;
	/** What the thread was opened with. */
	deps: ThreadDeps;
	/** The thread's fenced checkpoint saver on the sandbox's database. */
	saver: Thread["saver"];
	config: { configurable: { thread_id: string } };
	/** Compiles the flow again over the same saver: a new daemon. */
	graph(): RunGraph;
	events(): Promise<LoggedEvent[]>;
	types(): Promise<string[]>;
};

export type StartOptions = {
	/** The `claude-code` harness; without one, the Device has none. */
	harness?: AgentHarness;
	/** The name the Device adds `harness` under. Default `claude-code`. */
	harnessName?: HarnessName;
	decider?: Decider;
	/** The Device's connections; default: none, and no node servers (`connectionsOf`). */
	connections?: TestDeviceDeps["connections"];
	/** The called flows, by name. */
	flows?: Record<string, Flow>;
	/** The run's abort signal; read at each use, so a test can swap it. */
	signal?: AbortSignal;
	/** The clock. Default `now`. */
	now?: () => number;
	/** What `RunStarted` records as the run's inputs. */
	inputs?: InputValues;
	branch?: string;
	/** The flow file the run starts from; default none, as a quick run. */
	flowName?: string;
	/** The projects' knowledge folders on the Device; default none. */
	knowledge?: TestDeviceDeps["knowledge"];
	/** Takes the leases of Lease nodes; default: none can be taken. */
	leases?: LeaseTaker;
	/** Starts and stops the services of Service nodes; default: none. */
	services?: ServiceRunner;
};

let runs = 0;

/** A Device without services: a Service step fails with this. */
const NO_SERVICES: ServiceRunner = {
	bringUp: async () => {
		throw new Error("This computer runs no services.");
	},
	stop: async () => {},
	tail: () => "",
};

/** A Device without leases: a Lease step fails with this. */
const NO_LEASES: LeaseTaker = {
	take: async () => {
		throw new Error("This computer keeps no leases.");
	},
	release: async () => {},
};

/**
 * Placement over the Devices a test gives it: every Device of a run's plan
 * comes from `deviceById`, as the devices' port answers it. A test that
 * fakes one Device gives `() => device`.
 */
export function placementOn(
	deviceById: (id: string, run: PlacedRun) => Device,
) {
	return createPlacement({
		device: { id: TEST_DEVICE_ID },
		devices: { deviceById },
	});
}

/** A run row, its log with `RunStarted`, and its Thread. */
export async function startRun(
	sandbox: Sandbox,
	flow: Flow,
	options: StartOptions = {},
): Promise<Harness> {
	const { db } = sandbox;
	const runId = `run-${++runs}`;
	const projectId = "project-1";
	const flows = options.flows ?? {};
	await db
		.insert(project)
		.values({ id: projectId, spaceId: sandbox.spaceId, name: "repo" })
		.onConflictDoNothing();
	await db.insert(run).values({
		id: runId,
		spaceId: sandbox.spaceId,
		projectId,
		flowName: options.flowName ?? null,
		flow: JSON.stringify(flow),
		bodyFlows: JSON.stringify(flows),
		title: "test",
		worktreePath: sandbox.repoPath,
		branch: options.branch ?? "nightshift/test",
		baseRef: "main",
		walkerId: sandbox.deviceId,
	});
	const log = createRunLog(db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	await log.append({
		type: "RunStarted",
		runId,
		payload: {
			projectId,
			flowName: options.flowName ?? null,
			title: "test",
			start: flow.start,
			inputs: options.inputs ?? {},
		},
	});
	const bus = createRunBus();
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error("no run row");
	const local: TestDeviceDeps = {
		harnesses: options.harness
			? { [options.harnessName ?? "claude-code"]: options.harness }
			: {},
		...(options.decider ? { decider: options.decider } : {}),
		connections: options.connections ?? connectionsOf(),
		...(options.knowledge ? { knowledge: options.knowledge } : {}),
	};
	const device = () =>
		localDevice({ id: TEST_DEVICE_ID, name: "test", ...local });
	// What a step may touch, as the engine makes it once.
	const shared: StepShared = {
		log,
		bus,
		recorders: createRecorders({ db, bus, log }),
		placement: placementOn(device),
		now: options.now ?? now,
		minuteMs: MINUTE,
		settings: defaultRunSettings,
		kindOf,
		leases: options.leases ?? NO_LEASES,
		services: options.services ?? NO_SERVICES,
		artifacts: createArtifactStore(sandbox.dataDir),
		keptValues: (kept) => keptValues(db, kept),
		remembered: (at) => readMemory(db, at),
		gitAuthor: (personId) => gitAuthorOf(db, personId),
	};
	const deps: ThreadDeps = {
		shared,
		db,
		flowOf: () => flow,
		calledFlowsOf: () => flows,
	};
	const thread = openThread(row, deps);
	const { ctx, saver } = thread;
	const own = ctx.signal;
	// Read at each use: a test may set `options.signal` later.
	ctx.signal = () => options.signal ?? own();
	return {
		ctx,
		local,
		log,
		runId,
		thread,
		deps,
		saver,
		config: { configurable: { thread_id: runId } },
		graph: () => compileFlow(flow, ctx).compile({ checkpointer: saver }),
		events: () => log.events(runId),
		types: async () => (await log.events(runId)).map((e) => e.type),
	};
}

export type Driven = {
	/** The root's interrupts, in order. The runner reacts to the last. */
	parked: Parked[];
	events: RunEvent[];
	state: RunStateValues;
	next: string[];
	/** How the drive ended, as the runner sees it (`endingOf` says what it appends). */
	outcome: DriveOutcome;
};

/**
 * Drives the graph with the runner's stream loop (`driveGraph`) under the
 * thread's fence, and collects the root's interrupts and the custom
 * events. Default: the thread's own graph. Pass `h.graph()` for a new
 * daemon. Rejects as the runner's drive fails: an engine error, or a graph
 * that stops without an end or an interrupt.
 */
export async function drive(
	h: Harness,
	input: StreamInput,
	graph: RunGraph = h.thread.graph,
): Promise<Driven> {
	const events: RunEvent[] = [];
	const outcome = await driveGraph(graph, h.runId, input, {
		fence: h.thread.fence,
		onEvent: (event) => events.push(event),
	});
	const snapshot = await graph.getState(h.config);
	return {
		parked: outcome.kind === "parked" ? outcome.interrupts : [],
		events,
		state: snapshot.values as RunStateValues,
		next: [...snapshot.next],
		outcome,
	};
}

/**
 * The one step the state holds (a wait, a park or a Gate), or null when it
 * holds none. Throws when it holds several: a test of parallel branches
 * reads them by node (`heldOf`).
 */
export function held(state: { pending?: PendingValue }): Pending | null {
	const holds = Object.values(heldOf(state.pending));
	if (holds.length > 1) throw new Error("The state holds several steps.");
	return holds[0] ?? null;
}

export const payloads = <T extends EngineEventType>(
	events: LoggedEvent[],
	type: T,
): EnginePayloads[T][] =>
	events
		.filter((e) => e.type === type)
		.map((e) => e.payload as EnginePayloads[T]);

/**
 * A real runner over the harness's database, log, bus and Device, as the
 * engine makes one. Each run's flow comes from its row. It opens its own
 * threads: a drive of the harness and a Turn of the runner are two daemons
 * on one database.
 */
export function testRunner(
	h: Harness,
	overrides: Partial<Omit<RunnerDeps, "shared">> & {
		/** What a step may touch, with these members replaced. */
		shared?: Partial<StepShared>;
	} = {},
): Runner {
	const { shared, ...rest } = overrides;
	return createRunner({
		...h.deps,
		flowOf: parseRunFlow,
		calledFlowsOf: parseCalledFlows,
		...rest,
		shared: { ...h.deps.shared, ...shared },
	});
}
