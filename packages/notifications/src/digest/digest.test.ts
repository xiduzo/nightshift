import { describe, expect, test } from "bun:test";

import { type DigestSource, digestFrom, readDigest } from "./digest";

/** What the digest says of runs and Gates: the push's sum and one line per run. */

type EndedRun = Awaited<ReturnType<DigestSource["endedRuns"]>>[number];

const HOUR = 60 * 60_000;
const TO = Date.UTC(2026, 9, 21, 7);
const FROM = TO - 24 * HOUR;

function ended(id: string, over: Partial<EndedRun> = {}): EndedRun {
	return {
		id,
		spaceId: "space-1",
		title: `Triage · ${id}`,
		flowName: "Triage",
		status: "finished",
		result: null,
		reason: null,
		costUsd: 1,
		costEstimated: false,
		costMissing: 0,
		costCalls: 1,
		warnings: [],
		endedAt: TO - HOUR,
		...over,
	};
}

function sourceOf(
	runs: EndedRun[],
	gates: Awaited<ReturnType<DigestSource["waitingGates"]>> = [],
): DigestSource {
	return {
		endedRuns: async (spaceId, since) =>
			runs.filter((r) => r.spaceId === spaceId && r.endedAt > since),
		waitingGates: async (spaceId) => gates.filter((g) => g.spaceId === spaceId),
	};
}

const read = (source: DigestSource, time: string | null = "07:00") =>
	readDigest(source, ["space-1"], { from: FROM, to: TO, time });

describe("the digest", () => {
	test("sums up the runs, their cost and the Gates that wait", async () => {
		const digest = await read(
			sourceOf(
				[
					ended("a", { costUsd: 2 }),
					ended("b", { costUsd: 1.5 }),
					ended("c", { costUsd: 0.2, costEstimated: true }),
					ended("d", { status: "failed", costUsd: 0.5 }),
					ended("e", { status: "stopped", costUsd: 0, costCalls: 0 }),
				],
				[
					{
						spaceId: "space-1",
						runId: "f",
						stepId: "s",
						runTitle: "Review · 12",
						flowName: "Review",
					},
				],
			),
		);
		expect(digest).toMatchObject({
			from: FROM,
			to: TO,
			title: "Night Shift: last night",
			body: "3 runs finished, 1 failed, 1 stopped. About $4.20 spent. 1 Gate waits for you.",
			gates: [
				{ spaceId: "space-1", runId: "f", stepId: "s", title: "Review · 12" },
			],
		});
	});

	test("says one line per run: status, cost with its basis, pull request or reason", async () => {
		const digest = await read(
			sourceOf([
				ended("pr", {
					endedAt: TO - 3 * HOUR,
					metrics: {
						wallMs: 1,
						agentMs: 1,
						gateWaitMs: 0,
						tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
						costBasis: "billed",
						prUrl: "https://github.com/acme/site/pull/7",
					},
				}),
				ended("broke", {
					endedAt: TO - 2 * HOUR,
					status: "failed",
					costUsd: 0.3,
					costMissing: 1,
					reason: "The step   ran\nout of time.",
					warnings: [
						{ kind: "budget" as never, message: "", at: 0 } as never,
						{ kind: "cost-unknown", message: "", at: 0 } as never,
						{ kind: "a-later-kind" as never, message: "", at: 0 } as never,
					],
				}),
				ended("idle", {
					endedAt: TO - HOUR,
					result: "nothing-to-do",
					costUsd: 0,
					costCalls: 1,
					costMissing: 1,
				}),
				{
					...ended("quick", { endedAt: TO - HOUR / 2 }),
					flowName: null,
					title: "Fix the flaky login test",
				},
				ended("before", { endedAt: FROM }),
			]),
		);
		expect(digest?.runs).toEqual([
			{
				runId: "quick",
				spaceId: "space-1",
				title: "Quick run · Fix the flaky login test",
				status: "finished",
				statusText: "Finished",
				detail: "$1.00",
				prUrl: null,
				endedAt: TO - HOUR / 2,
			},
			expect.objectContaining({
				runId: "idle",
				statusText: "Nothing to do",
				detail: "Cost unknown",
			}),
			expect.objectContaining({
				runId: "broke",
				statusText: "Failed",
				detail:
					"At least $0.30 · The step ran out of time. · Reached its budget or turn limit",
			}),
			expect.objectContaining({
				runId: "pr",
				title: "Triage · pr",
				detail: "$1.00",
				prUrl: "https://github.com/acme/site/pull/7",
			}),
		]);
	});

	test("is nothing when no run ended and no Gate waits", async () => {
		expect(await read(sourceOf([ended("old", { endedAt: FROM - HOUR })]))).toBe(
			null,
		);
	});

	test("says cost unknown when no run knows its cost", async () => {
		const digest = await read(
			sourceOf([ended("a", { costUsd: 0, costMissing: 2 })]),
		);
		expect(digest?.body).toBe("1 run finished. Cost unknown.");
	});

	test("an afternoon digest is not about last night", async () => {
		const digest = await read(sourceOf([ended("a")]), "14:00");
		expect(digest?.title).toBe("Night Shift: your digest");
	});
});

describe("where a digest starts", () => {
	test("at the last digest, a day back for the first, a week back at most", () => {
		expect(digestFrom(TO - 5 * HOUR, TO)).toBe(TO - 5 * HOUR);
		expect(digestFrom(null, TO)).toBe(TO - 24 * HOUR);
		expect(digestFrom(TO - 30 * 24 * HOUR, TO)).toBe(TO - 7 * 24 * HOUR);
	});
});

describe("the knowledge sources in the digest", () => {
	type Problem = Awaited<
		ReturnType<NonNullable<DigestSource["sourceProblems"]>>
	>[number];
	const problem = (over: Partial<Problem>): Problem => ({
		projectId: "p1",
		projectName: "Lighthouse",
		flow: "knowledge-jira",
		label: "Jira",
		health: "failed",
		lastRun: { id: "run-9", status: "failed", at: TO - 2 * HOUR },
		...over,
	});
	const withSources = (runs: EndedRun[], problems: Problem[]) => ({
		...sourceOf(runs),
		sourceProblems: async () => problems,
	});

	test("says which source did not sync and which is out of date, the failed ones first", async () => {
		const digest = await read(
			withSources(
				[ended("a")],
				[
					problem({
						flow: "web",
						label: "Web pages",
						health: "stale",
						lastRun: { id: "run-1", status: "finished", at: TO - 200 * HOUR },
					}),
					problem({}),
				],
			),
		);
		expect(digest?.body).toBe(
			"1 run finished. $1.00 spent. 1 knowledge source did not sync. 1 has not synced in a week.",
		);
		expect(digest?.sources).toEqual([
			{
				spaceId: "space-1",
				projectId: "p1",
				title: "Jira · Lighthouse",
				statusText: "Last sync failed",
				runId: "run-9",
			},
			{
				spaceId: "space-1",
				projectId: "p1",
				title: "Web pages · Lighthouse",
				statusText: "Not synced in a week",
				runId: "run-1",
			},
		]);
	});

	test("a failed source makes a digest on a quiet night; one that is only out of date does not", async () => {
		const failed = await read(withSources([], [problem({})]));
		expect(failed?.body).toBe("1 knowledge source did not sync.");
		const stale = await read(
			withSources(
				[],
				[problem({ health: "stale" }), problem({ health: "stale" })],
			),
		);
		expect(stale).toBeNull();
	});
});
