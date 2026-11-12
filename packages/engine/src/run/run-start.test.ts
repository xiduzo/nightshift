import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import {
	type AgentNode,
	type CommandNode,
	FLOW_VERSION,
	type Flow,
	type FlowNode,
} from "@nightshift/flows";
import type { StartRunInput } from "../contract";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import type { UsageMoment } from "../usage";
import { createEngine, type Engine } from "./engine";
import {
	createRunStart,
	quickRunTitle,
	type RunStartDeps,
	START_TOO_LONG,
} from "./run-start";
import { TEST_RUN_FROM_EDITOR } from "./test-run";

/**
 * Run start's own rules: the title of a quick run, the deadline of a
 * start, and who may start a test run. The requirements a Device must
 * meet are Placement's (`placement/fit.test.ts`). The whole start path
 * (worktree, run row, `RunStarted`) is covered by engine.test.ts through
 * the public interface, and so is a test run's here.
 */

const node = (fields: Record<string, unknown>): FlowNode =>
	fields as unknown as FlowNode;

const agent = (id: string, fields: Record<string, unknown> = {}) =>
	node({ id, type: "agent", prompt: "work", ...fields }) as AgentNode;

describe("quickRunTitle", () => {
	const flow = (nodes: FlowNode[]): Flow =>
		({
			version: 2,
			start: nodes[0]?.id ?? "a",
			nodes,
			edges: [],
		}) as unknown as Flow;

	test("is the first Agent prompt, whitespace folded", () => {
		expect(
			quickRunTitle(flow([agent("a", { prompt: "  fix\n the   bug " })])),
		).toBe("fix the bug");
	});

	test("falls back when no Agent node has a prompt", () => {
		expect(quickRunTitle(flow([node({ id: "c", type: "command" })]))).toBe(
			"Quick run",
		);
	});

	test("cuts a long prompt at 80 characters with an ellipsis", () => {
		const title = quickRunTitle(
			flow([agent("a", { prompt: "x".repeat(100) })]),
		);
		expect(title).toHaveLength(80);
		expect(title.endsWith("…")).toBe(true);
	});
});

describe("a start that hangs", () => {
	test("is refused after its deadline, and writes nothing after that", async () => {
		let settled = false;
		let release = () => {};
		const deps = {
			startDeadlineMs: 20,
			// The runner frees the start's slot when its prepare settles.
			runner: {
				take: async (_runId: string, turn: { prepare(): Promise<unknown> }) => {
					try {
						await turn.prepare();
					} finally {
						settled = true;
					}
				},
			},
			projectRow: async () => ({ id: "p1", spaceId: "s1" }),
			// The Device never answers: the plan waits until the test ends it.
			plan: () =>
				new Promise((_, reject) => {
					release = () => reject(new Error("released"));
				}),
		} as unknown as RunStartDeps;
		const start = createRunStart(deps).start(
			{ projectId: "p1", flowName: "nightly" },
			{ kind: "manual" },
		);
		await expect(start).rejects.toThrow(START_TOO_LONG);
		expect(settled).toBe(true);
		release();
	});
});

describe("a test run's start", () => {
	/** A start with pins and skips: only a person's start of a saved flow takes them. */
	const testStart = (input: Record<string, unknown>) =>
		({
			projectId: "p1",
			test: { skipped: { check: "pass" } },
			...input,
		}) as unknown as StartRunInput;
	const deps = {
		runner: {
			take: async (_runId: string, turn: { prepare(): Promise<unknown> }) => {
				await turn.prepare();
			},
		},
		projectRow: async () => {
			throw new Error("A refused start asks for no project.");
		},
	} as unknown as RunStartDeps;

	test("is refused for a schedule, a webhook and a quick run", async () => {
		const { start } = createRunStart(deps);
		const at = 1_000;
		for (const [input, trigger] of [
			[{ flowName: "watch" }, { kind: "schedule", scheduleId: "s", at }],
			[{ flowName: "watch" }, { kind: "webhook", scheduleId: "s", at }],
			[{ flow: { version: FLOW_VERSION } }, { kind: "manual" }],
		] as const) {
			await expect(start(testStart(input), trigger)).rejects.toThrow(
				TEST_RUN_FROM_EDITOR,
			);
		}
	});
});

describe("a test run that pins an Agent", () => {
	let sandbox: Sandbox;
	let engines: Engine[];
	beforeEach(async () => {
		sandbox = await createSandbox();
		engines = [];
		noted = [];
	});
	afterEach(async () => {
		for (const engine of engines) await engine.dispose();
		await sandbox.cleanup();
	});

	/** The usage moments the daemons noted. */
	let noted: UsageMoment[] = [];

	/** This computer as a daemon, with these harnesses. */
	function daemon(harnesses: Parameters<typeof withDevice>[0]["harnesses"]) {
		const engine = createEngine(
			withDevice({
				db: sandbox.db,
				harnesses,
				deviceId: sandbox.deviceId,
				dataDir: sandbox.dataDir,
				scheduler: false,
				usage: { note: (moment) => void noted.push(moment) },
			}),
		);
		engines.push(engine);
		return engine.space(sandbox.spaceId);
	}

	const research: AgentNode = {
		id: "research",
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Find leads",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		session: "fresh",
	};
	const report: CommandNode = {
		id: "report",
		type: "command",
		position: { x: 0, y: 0 },
		command: 'echo "{{research.summary}}"',
		stdout: "text",
	};
	const watch: Flow = {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: "research",
		nodes: [research, report],
		edges: [{ id: "e1", from: "research", outcome: "pass", to: "report" }],
	};

	test("starts on a computer without the Agent's harness, and the run says it is a test", async () => {
		// An earlier run, on a computer that has the harness.
		const before = daemon({
			"claude-code": fakeHarness({
				...reportingScript("pass", "Found 3 leads."),
				delayMs: 0,
			}),
		});
		const { id: projectId } = await before.addProject({
			repoPath: sandbox.repoPath,
		});
		await seedFlows(before, projectId, { watch });
		const earlier = await before.startRun({ projectId, flowName: "watch" });
		const ended = await waitFor(async () => {
			const run = await before.getRun(earlier.id);
			return run.status === "running" ? null : run;
		});
		expect(ended.status).toBe("finished");
		const source = ended.steps.find((s) => s.nodeId === "research");
		await engines[0]?.dispose();

		// This computer has no harness: a run of the flow is refused.
		const now = daemon({});
		await expect(
			now.startRun({ projectId, flowName: "watch" }),
		).rejects.toThrow("Add it under Agents.");
		const started = await now.startRun({
			projectId,
			flowName: "watch",
			test: {
				pinned: {
					research: { runId: earlier.id, stepId: source?.id ?? "" },
				},
			},
		});
		expect(started.test).toEqual({ pinned: ["research"], skipped: [] });
		const run = await waitFor(async () => {
			const detail = await now.getRun(started.id);
			return detail.status === "running" ? null : detail;
		});
		expect(run.status).toBe("finished");
		const [pinned, after] = run.steps;
		expect(pinned).toMatchObject({
			nodeId: "research",
			test: "pinned",
			pinnedFrom: { runId: earlier.id, stepId: source?.id },
			outcome: "pass",
			device: null,
			costUsd: 0,
		});
		expect(after?.outputs.log_tail).toBe("Found 3 leads.");

		// A useful answer counts for a real run only: a test run sends no usage.
		await now.act(started.id, { kind: "useful", useful: true });
		await now.act(earlier.id, { kind: "useful", useful: true });
		expect(noted.filter((moment) => moment.kind === "run-scored")).toEqual([
			{ kind: "run-scored", runId: earlier.id, score: "useful", value: 1 },
		]);
	});
});
