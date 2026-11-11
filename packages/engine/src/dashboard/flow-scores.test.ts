import { afterEach, beforeEach, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { now } from "@nightshift/time";
import { createEngine, type Engine } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { projectDashboard } from "./spaces";

/**
 * A flow scores its own runs: a Command step writes `scores` in its data,
 * and the flow's Flow health row and its detail show them, per name. A
 * person's useful answer has numbers of its own in the row.
 */

let sandbox: Sandbox;
let controller: AbortController;
let engine: Engine;
let space: SpaceEngine;
let projectId: string;

beforeEach(async () => {
	sandbox = await createSandbox();
	controller = new AbortController();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
		}),
		{ signal: controller.signal },
	);
	space = engine.space(sandbox.spaceId);
	projectId = (await space.addProject({ repoPath: sandbox.repoPath })).id;
});
afterEach(async () => {
	controller.abort();
	await sandbox.cleanup();
});

/** Replicates a paper: `held` is whether it held up after publication. */
const replicateFlow: Flow = {
	version: FLOW_VERSION,
	inputs: [{ name: "held", type: "text" }],
	outputs: [],
	start: "replicate",
	nodes: [
		{
			id: "replicate",
			type: "command",
			position: { x: 0, y: 0 },
			command:
				'printf \'{"scores": {"replicated": 1, "held_post_publication": %s}}\' "{{held}}" > "$NS_OUTPUT"',
			stdout: "text",
		},
	],
	edges: [],
};

async function finishedRun(held: string): Promise<string> {
	const started = await space.startRun({
		projectId,
		flowName: "replicate",
		inputs: { held },
	});
	await waitFor(
		async () =>
			(await space.getRun(started.id)).status === "finished" ? true : null,
		{ label: "the replicate run" },
	);
	return started.id;
}

test("a flow whose Command writes scores shows them in its Flow health row after three runs", async () => {
	await seedFlows(space, projectId, { replicate: replicateFlow });
	await finishedRun("1");
	await finishedRun("0");
	const last = await finishedRun("1");

	const dashboard = await projectDashboard(space, projectId, {
		now: now(),
		timeZone: "UTC",
	});
	const row = dashboard.flowHealth?.rows.find((r) => r.name === "replicate");
	expect(row?.runs).toBe(3);
	expect(
		row?.scores?.map(({ latest: { at: _, ...latest }, ...score }) => ({
			...score,
			latest,
		})),
	).toEqual([
		{
			name: "held_post_publication",
			runs: 3,
			count: 3,
			sum: 2,
			mean: 2 / 3,
			latest: { value: 1, runId: last },
		},
		{
			name: "replicated",
			runs: 3,
			count: 3,
			sum: 3,
			mean: 1,
			latest: { value: 1, runId: last },
		},
	]);

	// The run's own scores: on the Command's step, with no label.
	const run = await space.getRun(last);
	const stepId = run.steps[0]?.id as string;
	expect(
		run.metrics?.scores?.map((s) => [s.score, s.value, s.label, s.stepId]),
	).toEqual([
		["replicated", 1, null, stepId],
		["held_post_publication", 1, null, stepId],
	]);
	expect(run.warnings).toEqual([]);
});

test("a person's answer to Was this run useful? is the score useful, and Flow health counts it", async () => {
	await seedFlows(space, projectId, { replicate: replicateFlow });
	const first = await finishedRun("1");
	const second = await finishedRun("0");

	await space.act(first, { kind: "useful", useful: false });
	await space.act(first, { kind: "useful", useful: true });
	await space.act(second, { kind: "useful", useful: false });

	const run = await space.getRun(first);
	expect(
		run.metrics?.scores
			?.filter((s) => s.stepId === null)
			.map((s) => [s.score, s.value]),
	).toEqual([
		["useful", 0],
		["useful", 1],
	]);

	const dashboard = await projectDashboard(space, projectId, {
		now: now(),
		timeZone: "UTC",
	});
	const row = dashboard.flowHealth?.rows.find((r) => r.name === "replicate");
	// The flow asks no agent: a useful result cost nothing.
	expect(row?.useful).toEqual({
		answered: 2,
		useful: 1,
		costPerUseful: { costUsd: 0, costEstimated: false, costMissing: 0 },
	});
	expect(row?.scores?.map((score) => score.name)).toEqual([
		"held_post_publication",
		"replicated",
	]);
});
