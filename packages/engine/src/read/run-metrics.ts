import type { JsonValue } from "@nightshift/flows";
import type { LoggedEvent, ScoreName } from "../log";
import type { CostTally } from "./cost";
import type { DerivedSession, DerivedStep, StepSleep } from "./derive-steps";

/**
 * The run metrics: how long a run and each of its steps took, how long
 * agents worked and Gates waited, the tokens the agents used, how sure the
 * cost is, and the pull request a step opened. Pure over the derived steps
 * of the event log, like the cost (`cost.ts`) it sits beside. Nothing here
 * is stored, and nothing leaves the computer.
 *
 * The log has no turns and no tool calls: those live in the transcripts.
 * The visits of a node are the steps' `visit`.
 */

/** Tokens the agent sessions used, as their harnesses reported them. */
export type TokenCounts = {
	/** Every input token, the cached ones included. */
	input: number;
	output: number;
	/** The part of `input` read from the prompt cache. */
	cacheRead: number;
	/** The part of `input` written to the prompt cache. */
	cacheWrite: number;
};

/**
 * How sure a cost is. `billed`: every session and model call reported its
 * cost (or nothing could cost). `estimated`: part of it is priced from the
 * tokens. `unknown`: part of it ended without a cost, so the dollars are
 * only what is known.
 */
export type CostBasis = "billed" | "estimated" | "unknown";

/** The metrics of a run, or of one step of it. */
export type RunMetrics = {
	/** From its start to its end. Null while it has not ended. */
	wallMs: number | null;
	/** How long agent sessions worked, added up; a session that runs counts until its latest event. */
	agentMs: number;
	/** How long Gates waited for a person, added up. A Gate that still waits does not count yet. */
	gateWaitMs: number;
	tokens: TokenCounts;
	/** How sure `costUsd` is. */
	costBasis: CostBasis;
	/** The address of the GitHub pull request a step opened or named in its outputs. Null when none did. */
	prUrl: string | null;
	/**
	 * The feedback on the run (`Scored`), oldest first: each Gate answered,
	 * and what became of its pull request. Only a run's metrics have them.
	 * Older Hosts send none.
	 */
	scores?: RunScore[];
};

/** One `Scored` of a run: what it scores, its value and label, on which step, and when. */
export type RunScore = {
	score: ScoreName;
	value: number;
	label: string | null;
	stepId: string | null;
	at: number;
};

/** The run's scores, in log order. */
export function deriveScores(events: readonly LoggedEvent[]): RunScore[] {
	const scores: RunScore[] = [];
	for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
		if (e.type !== "Scored") continue;
		scores.push({
			score: e.payload.score,
			value: e.payload.value,
			label: e.payload.label,
			stepId: e.stepId,
			at: e.at,
		});
	}
	return scores;
}

const NO_TOKENS: TokenCounts = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cacheRead: a.cacheRead + b.cacheRead,
		cacheWrite: a.cacheWrite + b.cacheWrite,
	};
}

/** How sure a cost tally is. */
export function costBasis(cost: CostTally): CostBasis {
	if (cost.missing > 0) return "unknown";
	return cost.estimated ? "estimated" : "billed";
}

/** A session's tokens: its final usage, else what it used so far. */
export function sessionTokens(session: DerivedSession): TokenCounts {
	const usage = session.ending?.usage ?? session.spent?.usage;
	if (!usage) return NO_TOKENS;
	return {
		input: usage.inputTokens,
		output: usage.outputTokens,
		cacheRead: usage.cacheReadTokens ?? 0,
		cacheWrite: usage.cacheWriteTokens ?? 0,
	};
}

/**
 * How long a session worked: until it ended, else until its step ended
 * (Night Shift stopped during it), else until its latest event.
 */
function sessionTime(session: DerivedSession, step: DerivedStep): number {
	const end = session.endedAt ?? step.endedAt ?? session.lastAt;
	return Math.max(end - session.startedAt, 0);
}

/** The time of the spans that ended, added up. */
function closedTime(spans: readonly StepSleep[]): number {
	return spans.reduce(
		(sum, { from, to }) => (to === null ? sum : sum + Math.max(to - from, 0)),
		0,
	);
}

/** A GitHub pull request's address, the whole of a value. */
const PULL_REQUEST = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/;

/** The first pull request address in a JSON value, depth first. */
function pullRequestIn(value: JsonValue): string | null {
	if (typeof value === "string") {
		const text = value.trim();
		return PULL_REQUEST.test(text) ? text : null;
	}
	if (value === null || typeof value !== "object") return null;
	for (const item of Array.isArray(value) ? value : Object.values(value)) {
		const found = pullRequestIn(item);
		if (found) return found;
	}
	return null;
}

/**
 * The pull request a step's outputs name: a value that is a GitHub pull
 * request's address (the GitHub kit's `data.url`, an Agent's data), or
 * the last line of a command's log (`gh pr create` prints it there).
 */
export function pullRequestOf(
	outputs: Readonly<Record<string, JsonValue>>,
): string | null {
	for (const [name, value] of Object.entries(outputs)) {
		if (name === "log_tail") continue;
		const found = pullRequestIn(value);
		if (found) return found;
	}
	const log = outputs.log_tail;
	if (typeof log !== "string") return null;
	return pullRequestIn(log.trim().split("\n").at(-1) ?? "");
}

/** One step's metrics. The pull request counts once the step ended. */
export function stepMetrics(step: DerivedStep): RunMetrics {
	let tokens = NO_TOKENS;
	let agentMs = 0;
	for (const session of step.sessions) {
		tokens = addTokens(tokens, sessionTokens(session));
		agentMs += sessionTime(session, step);
	}
	return {
		wallMs: step.endedAt === null ? null : step.endedAt - step.startedAt,
		agentMs,
		gateWaitMs: closedTime(step.gateWaits),
		tokens,
		costBasis: costBasis(step.cost),
		prUrl: step.endedAt === null ? null : pullRequestOf(step.outputs),
	};
}

/**
 * A run's metrics: every step added up, also the steps of called flows.
 * `cost`: the run's cost (`sumCost`); `startedAt` and `endedAt`: the
 * run's start and end. The pull request is that of the step that ended
 * last with one.
 */
export function runMetrics(
	steps: readonly DerivedStep[],
	cost: CostTally,
	startedAt: number | null,
	endedAt: number | null,
	scores: RunScore[] = [],
): RunMetrics {
	let tokens = NO_TOKENS;
	let agentMs = 0;
	let gateWaitMs = 0;
	let prUrl: string | null = null;
	let prAt = Number.NEGATIVE_INFINITY;
	for (const step of steps) {
		const metrics = stepMetrics(step);
		tokens = addTokens(tokens, metrics.tokens);
		agentMs += metrics.agentMs;
		gateWaitMs += metrics.gateWaitMs;
		if (metrics.prUrl && step.endedAt !== null && step.endedAt >= prAt) {
			prUrl = metrics.prUrl;
			prAt = step.endedAt;
		}
	}
	return {
		wallMs:
			startedAt === null || endedAt === null
				? null
				: Math.max(endedAt - startedAt, 0),
		agentMs,
		gateWaitMs,
		tokens,
		costBasis: costBasis(cost),
		prUrl,
		scores,
	};
}
