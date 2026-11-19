import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import {
	type AgentNode,
	type CommandNode,
	FLOW_VERSION,
	type Flow,
} from "@nightshift/flows";
import type { Engine } from "../../src/engine";
import { seedFlows } from "../../src/testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../../src/testing/test-support";
import type { UsageMoment } from "../../src/usage";
import { createEngine } from "../../src/wire";

/**
 * A test run's start through a whole engine (ADR 27): a pinned Agent
 * stands in on a computer without its harness, and its output reaches the
 * next step. The rules of the start are `runs/start/` (on twins).
 */

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
