import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { event } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { iso, now } from "@nightshift/time";
import { eq } from "drizzle-orm";
import type { PullRequestView } from "../projects";
import { createEngine, type Engine } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";

/**
 * A pull request stored on the run is scored from `gh pr view`, with no
 * webhook and no scorePullRequests schedule.
 */

const PR = "https://github.com/acme/app/pull/12";
const MERGE_SHA = "0123456789abcdef0123456789abcdef01234567";

const openerFlow: Flow = {
	version: FLOW_VERSION,
	inputs: [{ name: "pr", type: "text" }],
	outputs: [],
	start: "open",
	nodes: [
		{
			id: "open",
			type: "command",
			position: { x: 0, y: 0 },
			command: 'echo "Creating pull request"; echo "{{pr}}"',
			stdout: "text",
		},
	],
	edges: [],
};

let sandbox: Sandbox;
let controller: AbortController;
let engine: Engine;
let space: SpaceEngine;
let projectId: string;
let view: PullRequestView | null;

beforeEach(async () => {
	view = {
		state: "merged",
		mergeSha: MERGE_SHA,
		mergedAt: iso(now()),
		closedAt: null,
		reverted: null,
	};
	sandbox = await createSandbox();
	controller = new AbortController();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			github: { viewPullRequest: async () => view },
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

describe("scoreOpenPullRequests", () => {
	test("scores a stored pull request from gh pr view, with no webhook", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, []);
		const started = await space.startRun({
			projectId,
			flowName: "opener",
			inputs: { pr: PR },
		});
		const run = await waitFor(
			async () => {
				const current = await space.getRun(started.id);
				return current.status === "finished" ? current : null;
			},
			{ label: "the opener run" },
		);
		expect(run.metrics?.prUrl).toBe(PR);
		const stored = await sandbox.db
			.select({ type: event.type })
			.from(event)
			.where(eq(event.runId, run.id));
		expect(stored.some((row) => row.type === "PullRequestOpened")).toBe(true);

		await engine.scoreOpenPullRequests();
		const scores = (await space.getRun(run.id)).metrics?.scores ?? [];
		expect(scores.map((score) => [score.score, score.label])).toEqual([
			["pr_merged", MERGE_SHA],
		]);
	});
});
