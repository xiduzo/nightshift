import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { fakeHarness } from "@nightshift/agents/testing";
import type { Flow, Schedule, WebhookEvent } from "@nightshift/flows";
import { createEngine, type Engine } from "../run/engine";
import type { SpaceEngine } from "../run/space-engine";
import { seedFlows } from "../testing/seed-flows";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import {
	pullRequestKey,
	pullRequestNews,
	REVERT_WINDOW_MS,
} from "./pull-request-scores";

/** Pull request scores: GitHub's webhooks tell what became of a run's pull request. */

const PR = "https://github.com/acme/app/pull/12";
const MERGE_SHA = "0123456789abcdef0123456789abcdef01234567";

const github = (event: string, body: unknown): WebhookEvent => ({
	headers: { "x-github-event": event },
	body: body as WebhookEvent["body"],
});

const closed = (extra: Record<string, unknown> = {}) => ({
	action: "closed",
	pull_request: { html_url: PR, merged: false, ...extra },
});

const push = (ref: string, messages: string[]) => ({
	ref,
	repository: { default_branch: "main" },
	commits: messages.map((message) => ({ message })),
});

describe("pullRequestNews", () => {
	test("reads a merged and a closed pull request", () => {
		expect(
			pullRequestNews(
				github(
					"pull_request",
					closed({ merged: true, merge_commit_sha: MERGE_SHA }),
				),
			),
		).toEqual([{ kind: "merged", url: PR, mergeSha: MERGE_SHA }]);
		expect(pullRequestNews(github("pull_request", closed()))).toEqual([
			{ kind: "closed", url: PR },
		]);
		// Opened, or another event: no news.
		expect(
			pullRequestNews(
				github("pull_request", { ...closed(), action: "opened" }),
			),
		).toEqual([]);
		expect(pullRequestNews(github("issues", closed()))).toEqual([]);
		expect(pullRequestNews({ headers: {}, body: closed() })).toEqual([]);
	});

	test("a merged pull request from GitHub's Revert button reverts the one it names", () => {
		const revert = {
			action: "closed",
			pull_request: {
				html_url: "https://github.com/acme/app/pull/13",
				merged: true,
				merge_commit_sha: null,
				body: "Reverts acme/app#12\n\nIt broke the night.",
			},
		};
		expect(pullRequestNews(github("pull_request", revert))).toEqual([
			{
				kind: "merged",
				url: "https://github.com/acme/app/pull/13",
				mergeSha: null,
			},
			{ kind: "reverted", url: PR },
		]);
	});

	test("a push to the default branch reverts the commits its messages name", () => {
		const message = `Revert "Add the thing"\n\nThis reverts commit ${MERGE_SHA}.`;
		expect(
			pullRequestNews(github("push", push("refs/heads/main", [message]))),
		).toEqual([{ kind: "reverted-commit", sha: MERGE_SHA }]);
		// A revert on another branch is not a revert of the merge.
		expect(
			pullRequestNews(github("push", push("refs/heads/fix", [message]))),
		).toEqual([]);
		expect(
			pullRequestNews(github("push", push("refs/heads/main", ["Fix it"]))),
		).toEqual([]);
	});

	test("compares addresses without case or a trailing slash", () => {
		expect(pullRequestKey("https://github.com/Acme/App/pull/12/")).toBe(PR);
	});
});

const SECRET = "s3cret";
// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
const HOOK_SECRET = "${HOOK_SECRET}";

let sandbox: Sandbox;
let controller: AbortController;
let engine: Engine;
let space: SpaceEngine;
let projectId: string;
/** How far the engine's clock is ahead of the log's. */
let ahead = 0;

beforeEach(async () => {
	ahead = 0;
	sandbox = await createSandbox();
	controller = new AbortController();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": fakeHarness() },
			dataDir: sandbox.dataDir,
			secret: async (name) => (name === "HOOK_SECRET" ? SECRET : undefined),
		}),
		{ signal: controller.signal, now: () => Date.now() + ahead },
	);
	space = engine.space(sandbox.spaceId);
	projectId = (await space.addProject({ repoPath: sandbox.repoPath })).id;
});
afterEach(async () => {
	controller.abort();
	await sandbox.cleanup();
});

/** Opens the pull request `{{pr}}`: `gh pr create` prints its address last. */
const openerFlow: Flow = {
	version: 7,
	inputs: [{ name: "pr", type: "text" }],
	outputs: [],
	start: "open",
	nodes: [
		{
			id: "open",
			type: "command",
			position: { x: 0, y: 0 },
			command: 'echo "Creating pull request"; echo "{{pr}}"',
			output: "text",
		},
	],
	edges: [],
};

const scores: Schedule = {
	id: "scores",
	inputs: {},
	enabled: true,
	webhook: { secret: HOOK_SECRET },
	scorePullRequests: true,
};

async function send(event: string, value: unknown, scheduleId = "scores") {
	const payload = new TextEncoder().encode(JSON.stringify(value));
	const { answer, done } = await engine.webhook({
		projectId,
		scheduleId,
		headers: new Headers({
			"content-type": "application/json",
			"x-github-event": event,
			"x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(payload).digest("hex")}`,
		}),
		body: payload,
	});
	await done;
	return answer;
}

async function finishedRun(pr: string) {
	const started = await space.startRun({
		projectId,
		flowName: "opener",
		inputs: { pr },
	});
	return waitFor(
		async () => {
			const run = await space.getRun(started.id);
			return run.status === "finished" ? run : null;
		},
		{ label: "the opener run" },
	);
}

const scoresOf = async (runId: string) =>
	((await space.getRun(runId)).metrics?.scores ?? []).map((s) => [
		s.score,
		s.label,
		s.stepId,
	]);

describe("a schedule that scores pull requests", () => {
	test("scores the run that opened the merged pull request, once", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, [scores]);
		const ours = await finishedRun(PR);
		const other = await finishedRun("https://github.com/acme/app/pull/99");
		expect(ours.metrics?.prUrl).toBe(PR);

		const merged = closed({
			html_url: "https://github.com/ACME/app/pull/12",
			merged: true,
			merge_commit_sha: MERGE_SHA,
		});
		expect(await send("pull_request", merged)).toEqual({ kind: "accepted" });
		// GitHub sends it again: nothing changes.
		await send("pull_request", merged);

		expect(await scoresOf(ours.id)).toEqual([["pr_merged", MERGE_SHA, null]]);
		expect(await scoresOf(other.id)).toEqual([]);
		// It started no run.
		expect(await space.listRuns()).toHaveLength(2);
	});

	test("a closed pull request scores pr_closed", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, [scores]);
		const ours = await finishedRun(PR);
		await send("pull_request", closed());
		await send("pull_request", closed());
		expect(await scoresOf(ours.id)).toEqual([["pr_closed", null, null]]);
	});

	test("a revert of the merge commit, or by GitHub's Revert button, scores reverted_within_7d once", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, [scores]);
		const ours = await finishedRun(PR);
		await send(
			"pull_request",
			closed({ merged: true, merge_commit_sha: MERGE_SHA }),
		);
		await send(
			"push",
			push("refs/heads/main", [
				`Revert "Add the thing"\n\nThis reverts commit ${MERGE_SHA.slice(0, 12)}.`,
			]),
		);
		await send("pull_request", {
			action: "closed",
			pull_request: {
				html_url: "https://github.com/acme/app/pull/13",
				merged: true,
				body: "Reverts acme/app#12",
			},
		});
		expect(await scoresOf(ours.id)).toEqual([
			["pr_merged", MERGE_SHA, null],
			["reverted_within_7d", MERGE_SHA.slice(0, 12), null],
		]);
	});

	test("a revert more than 7 days after the merge scores nothing", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, [scores]);
		const ours = await finishedRun(PR);
		await send(
			"pull_request",
			closed({ merged: true, merge_commit_sha: MERGE_SHA }),
		);
		ahead = REVERT_WINDOW_MS + 60_000;
		await send(
			"push",
			push("refs/heads/main", [`This reverts commit ${MERGE_SHA}.`]),
		);
		expect(await scoresOf(ours.id)).toEqual([["pr_merged", MERGE_SHA, null]]);
	});

	test("a revert of a pull request that never merged scores nothing", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, [scores]);
		const ours = await finishedRun(PR);
		await send("pull_request", {
			action: "closed",
			pull_request: {
				html_url: "https://github.com/acme/app/pull/13",
				merged: true,
				body: "Reverts acme/app#12",
			},
		});
		expect(await scoresOf(ours.id)).toEqual([]);
	});

	test("a schedule without scorePullRequests scores nothing", async () => {
		await seedFlows(space, projectId, { opener: openerFlow }, [
			{ ...scores, scorePullRequests: undefined, signal: { name: "pr" } },
		]);
		const ours = await finishedRun(PR);
		await send("pull_request", closed({ merged: true }));
		expect(await scoresOf(ours.id)).toEqual([]);
	});
});
