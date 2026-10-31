import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import type { JsonValue, WebhookEvent } from "@nightshift/flows";
import { and, eq, sql } from "drizzle-orm";
import type { RunLog, RunState, ScoreName } from "../log";
import { runFacts } from "../read";

/**
 * Pull request scores from GitHub's webhooks: what became of the pull
 * request a run opened. A webhook schedule with `scorePullRequests` hands
 * each event it takes here. Plain JSON from the webhook, no GitHub client,
 * no polling: GitHub sends the news, Night Shift only reads it.
 *
 * - `pull_request` closed and merged: `pr_merged` on the run whose metrics
 *   name that pull request's address (`html_url`), with the merge commit's
 *   sha as its label. Closed and not merged: `pr_closed`.
 * - A revert, within 7 days of the merge: `reverted_within_7d`. GitHub
 *   sends no event "reverted", so two facts tell it, both read from
 *   events GitHub sends anyway:
 *   - a push to the default branch with a commit whose message says
 *     `This reverts commit <sha>.` (what `git revert` writes), where the
 *     sha is the merge commit a `pr_merged` score keeps;
 *   - a merged pull request whose body says `Reverts <owner>/<repo>#<n>`
 *     (what GitHub's Revert button writes).
 *
 * A run gets each score once: a webhook sent again changes nothing. Only
 * the runs this computer walks get a score, as only they wake on a
 * signal: the Walker is a run's only writer. In a Space with a Host, the
 * Host walks the runs and takes the webhooks.
 */

/** What a GitHub webhook says about pull requests, as the scores read it. */
export type PullRequestNews =
	| { kind: "merged"; url: string; mergeSha: string | null }
	| { kind: "closed"; url: string }
	/** A merged pull request that reverts the one at `url`. */
	| { kind: "reverted"; url: string }
	/** A commit on the default branch that reverts commit `sha`. */
	| { kind: "reverted-commit"; sha: string };

/** How long after its merge a revert counts. */
export const REVERT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const isRecord = (
	value: JsonValue | undefined,
): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: JsonValue | undefined): string | null =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** A pull request's address as the scores compare it: lower case, no trailing slash. */
export function pullRequestKey(url: string): string {
	return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** `Reverts owner/repo#12`, as GitHub's Revert button writes it in the body. */
const REVERTS_PULL = /^Reverts\s+([\w.-]+\/[\w.-]+)#(\d+)\b/m;
/** `This reverts commit <sha>`, as `git revert` writes it. */
const REVERTS_COMMIT = /This reverts commit ([0-9a-f]{7,40})\b/g;

function pullRequestEvent(body: Record<string, JsonValue>): PullRequestNews[] {
	const pr = body.pull_request;
	if (body.action !== "closed" || !isRecord(pr)) return [];
	const url = text(pr.html_url);
	if (!url) return [];
	if (pr.merged !== true) return [{ kind: "closed", url }];
	const news: PullRequestNews[] = [
		{ kind: "merged", url, mergeSha: text(pr.merge_commit_sha) },
	];
	const reverts = REVERTS_PULL.exec(text(pr.body) ?? "");
	if (reverts) {
		news.push({
			kind: "reverted",
			url: `https://github.com/${reverts[1]}/pull/${reverts[2]}`,
		});
	}
	return news;
}

function pushEvent(body: Record<string, JsonValue>): PullRequestNews[] {
	const repository = isRecord(body.repository) ? body.repository : {};
	const branch = text(repository.default_branch);
	// A revert counts only where the merge went: the default branch.
	if (!branch || body.ref !== `refs/heads/${branch}`) return [];
	const commits = Array.isArray(body.commits) ? body.commits : [];
	const shas = new Set<string>();
	for (const commit of commits) {
		const message = isRecord(commit) ? (text(commit.message) ?? "") : "";
		for (const match of message.matchAll(REVERTS_COMMIT)) {
			if (match[1]) shas.add(match[1]);
		}
	}
	return [...shas].map((sha) => ({ kind: "reverted-commit", sha }));
}

/**
 * What a webhook says about pull requests: GitHub's `pull_request` and
 * `push` events (`X-GitHub-Event`). Anything else says nothing.
 */
export function pullRequestNews(webhook: WebhookEvent): PullRequestNews[] {
	const body = webhook.body;
	if (!isRecord(body)) return [];
	switch (webhook.headers["x-github-event"]) {
		case "pull_request":
			return pullRequestEvent(body);
		case "push":
			return pushEvent(body);
		default:
			return [];
	}
}

export type PullRequestScoresDeps = {
	db: Database;
	/** Appends `Scored`, and reads the runs. */
	log: Pick<RunLog, "append" | "state" | "walkerId">;
	now(): number;
};

export type PullRequestScores = ReturnType<typeof createPullRequestScores>;

/** The `pr_merged` score of a run, when it has one. */
const mergedOf = (state: RunState) =>
	state.scores.find((s) => s.payload.score === "pr_merged") ?? null;

const hasScore = (state: RunState, score: ScoreName) =>
	state.scores.some((s) => s.payload.score === score);

export function createPullRequestScores(deps: PullRequestScoresDeps) {
	const { db, log } = deps;

	/** The runs of the project this computer walks that are on these conditions. */
	async function runsWhere(
		projectId: string,
		type: "StepEnded" | "Scored",
		where: ReturnType<typeof sql>,
	): Promise<string[]> {
		const walkerId = await log.walkerId();
		const rows = await db
			.selectDistinct({ runId: event.runId })
			.from(event)
			.innerJoin(run, eq(run.id, event.runId))
			.where(
				and(
					eq(event.type, type),
					eq(run.projectId, projectId),
					eq(run.walkerId, walkerId),
					where,
				),
			);
		return rows.flatMap((row) => (row.runId ? [row.runId] : []));
	}

	/**
	 * The runs whose metrics name the pull request at `url`. The query only
	 * narrows down (a step's outputs hold the address); the run metrics
	 * decide, as the Runs page shows them.
	 */
	async function runsOfPullRequest(
		projectId: string,
		url: string,
	): Promise<{ runId: string; state: RunState }[]> {
		const key = pullRequestKey(url);
		// LIKE in SQLite ignores the case of ASCII letters, as GitHub's owner and repo names do.
		const pattern = `%${key.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
		const ids = await runsWhere(
			projectId,
			"StepEnded",
			sql`${event.payload} LIKE ${pattern} ESCAPE '\\'`,
		);
		const found: { runId: string; state: RunState }[] = [];
		for (const runId of ids) {
			const state = await log.state(runId);
			const prUrl = runFacts(state).metrics.prUrl;
			if (prUrl && pullRequestKey(prUrl) === key) found.push({ runId, state });
		}
		return found;
	}

	/** The runs whose `pr_merged` names the merge commit `sha` (whole, or its start). */
	async function runsOfMergeCommit(
		projectId: string,
		sha: string,
	): Promise<{ runId: string; state: RunState }[]> {
		const ids = await runsWhere(
			projectId,
			"Scored",
			sql`json_extract(${event.payload}, '$.score') = 'pr_merged' AND json_extract(${event.payload}, '$.label') LIKE ${`${sha}%`}`,
		);
		return Promise.all(
			ids.map(async (runId) => ({ runId, state: await log.state(runId) })),
		);
	}

	async function write(
		runId: string,
		score: ScoreName,
		label: string | null,
	): Promise<void> {
		await log.append({
			type: "Scored",
			runId,
			stepId: null,
			payload: { score, value: 1, label },
		});
	}

	/** A revert of the run's merged pull request, when it is within the window. */
	async function reverted(
		runId: string,
		state: RunState,
		at: number,
		label: string,
	): Promise<boolean> {
		const merged = mergedOf(state);
		if (!merged || hasScore(state, "reverted_within_7d")) return false;
		if (at - merged.at > REVERT_WINDOW_MS) return false;
		await write(runId, "reverted_within_7d", label);
		return true;
	}

	return {
		/**
		 * Scores the project's runs this computer walks by what the webhook
		 * says about their pull requests. Returns how many scores it wrote.
		 */
		async take(projectId: string, webhook: WebhookEvent): Promise<number> {
			const at = deps.now();
			let written = 0;
			for (const news of pullRequestNews(webhook)) {
				if (news.kind === "reverted-commit") {
					for (const { runId, state } of await runsOfMergeCommit(
						projectId,
						news.sha,
					)) {
						if (await reverted(runId, state, at, news.sha)) written++;
					}
					continue;
				}
				for (const { runId, state } of await runsOfPullRequest(
					projectId,
					news.url,
				)) {
					if (news.kind === "reverted") {
						if (await reverted(runId, state, at, news.url)) written++;
						continue;
					}
					// Merged once. A pull request closed, opened again and merged
					// has both: it was closed first.
					if (hasScore(state, "pr_merged")) continue;
					if (news.kind === "merged") {
						await write(runId, "pr_merged", news.mergeSha);
						written++;
					} else if (!hasScore(state, "pr_closed")) {
						await write(runId, "pr_closed", null);
						written++;
					}
				}
			}
			return written;
		},
	};
}
