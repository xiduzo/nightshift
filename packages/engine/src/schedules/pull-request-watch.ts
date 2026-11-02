import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import { DAY_MS, nextClockTime, parseInstant } from "@nightshift/time";
import { and, eq } from "drizzle-orm";
import type { RunLog, RunState } from "../log";
import type { PullRequestReader, PullRequestView } from "../projects";
import type { UsageNotes } from "../usage";
import {
	REVERT_WINDOW_MS,
	recordPullRequestScore,
} from "./pull-request-scores";

/**
 * Each morning, until a run's pull request is merged or closed, asks
 * `gh pr view` and writes the same scores a webhook would. No webhook
 * and no `scorePullRequests` schedule are required.
 */

/** How long until the next local 07:00. At least a minute, at most a day. */
export function msUntilMorning(at: number): number {
	let wait = nextClockTime(at, 7, 0) - at;
	if (wait < 60_000) wait = nextClockTime(at + 60_000, 7, 0) - at;
	if (wait < 60_000) wait = DAY_MS;
	return wait;
}

const scored = (state: RunState, name: string) =>
	state.scores.find((score) => score.payload.score === name) ?? null;

function atOf(iso: string | null, fallback: number): number {
	if (!iso) return fallback;
	const parsed = parseInstant(iso);
	return Number.isNaN(parsed) ? fallback : parsed;
}

export function createPullRequestWatch(deps: {
	db: Database;
	log: Pick<RunLog, "append" | "state" | "walkerId">;
	now(): number;
	usage?: UsageNotes;
	github: PullRequestReader;
}) {
	const { db, log } = deps;

	async function scoreOne(runId: string, state: RunState): Promise<void> {
		const url = state.pullRequest?.url;
		if (!url) return;
		if (scored(state, "pr_closed")) return;
		const merged = scored(state, "pr_merged");
		const reverted = scored(state, "reverted_within_7d");
		if (merged && reverted) return;
		const view = await deps.github.viewPullRequest(url);
		if (!view) return;
		if (merged && !reverted) {
			await maybeRevert(runId, view, merged.at);
			return;
		}
		if (view.state === "open") return;
		const outcomeAt = atOf(
			view.state === "merged" ? view.mergedAt : view.closedAt,
			deps.now(),
		);
		if (view.state === "merged") {
			await recordPullRequestScore(
				deps,
				runId,
				"pr_merged",
				view.mergeSha,
				outcomeAt,
			);
			if (view.reverted) await maybeRevert(runId, view, outcomeAt);
			return;
		}
		await recordPullRequestScore(deps, runId, "pr_closed", null, outcomeAt);
	}

	async function maybeRevert(
		runId: string,
		view: PullRequestView,
		mergedAt: number,
	): Promise<void> {
		if (!view.reverted) return;
		if (deps.now() - mergedAt > REVERT_WINDOW_MS) return;
		await recordPullRequestScore(
			deps,
			runId,
			"reverted_within_7d",
			view.reverted.label,
			deps.now(),
		);
	}

	return {
		/** Scores every open pull request this computer walks. */
		async score(): Promise<void> {
			const walkerId = await log.walkerId();
			const rows = await db
				.selectDistinct({ runId: event.runId })
				.from(event)
				.innerJoin(run, eq(run.id, event.runId))
				.where(
					and(eq(event.type, "PullRequestOpened"), eq(run.walkerId, walkerId)),
				);
			for (const row of rows) {
				if (!row.runId) continue;
				try {
					await scoreOne(row.runId, await log.state(row.runId));
				} catch {
					// The next morning tries this run again.
				}
			}
		},
	};
}
