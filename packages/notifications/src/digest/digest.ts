import type { OpenGate, RunSummary, SourceProblem } from "@nightshift/engine";

/**
 * The morning digest: one line per run that ended since the last digest
 * (its status, its cost, and the pull request it opened or why it ended),
 * the Gates that still wait, and the knowledge sources whose last sync
 * failed or is more than a week old. A push says the sum ("3 runs
 * finished, 1 failed. $4.20 spent. 1 Gate waits for you."). The phone's
 * inbox shows the lines and links each to its run. Nothing to say: no
 * digest. A source that is only out of date makes no digest of its own.
 */

/** A run that ended, as the digest reads it from the run list. */
export type EndedRun = Pick<
	RunSummary,
	| "id"
	| "title"
	| "flowName"
	| "status"
	| "result"
	| "reason"
	| "costUsd"
	| "costEstimated"
	| "costMissing"
	| "costCalls"
	| "warnings"
	| "metrics"
> & { spaceId: string; endedAt: number };

/** A Gate that waits, as the digest names it. */
export type WaitingGate = Pick<
	OpenGate,
	"spaceId" | "runId" | "stepId" | "runTitle" | "flowName"
>;

/** One line of the digest: a run that ended. */
export type DigestRun = {
	runId: string;
	spaceId: string;
	/** The flow and the run's inputs ("Triage · login bug"), or "Quick run · <prompt>". */
	title: string;
	status: RunSummary["status"];
	/** "Finished", "Nothing to do", "Failed", "Stopped". */
	statusText: string;
	/**
	 * The cost ("$1.20", "about $1.20", "at least $1.20", "cost unknown"),
	 * then why it ended when it opened no pull request, then what went
	 * wrong on the way. Null: nothing to add.
	 */
	detail: string | null;
	/** The pull request the run opened. */
	prUrl: string | null;
	endedAt: number;
};

/** One Gate that waits, in the digest. */
export type DigestGate = {
	spaceId: string;
	runId: string;
	stepId: string;
	/** The run's title, as a digest line names it. */
	title: string;
};

/** A knowledge source of a Space, as the digest reads it: its last sync needs a person. */
export type KnowledgeSourceProblem = SourceProblem & { spaceId: string };

/** One line of the digest: a knowledge source whose last sync needs a person. */
export type DigestKnowledgeSource = {
	spaceId: string;
	projectId: string;
	/** The source and its project ("Jira · Lighthouse"). */
	title: string;
	/** "Last sync failed", "Not synced in a week". */
	statusText: string;
	/** Its last run. */
	runId: string;
};

/** One digest. */
export type Digest = {
	/** The runs that ended after `from` and by `to`, epoch ms. */
	from: number;
	to: number;
	/** "Night Shift: last night". */
	title: string;
	/** "3 runs finished, 1 failed. $4.20 spent. 1 Gate waits for you." */
	body: string;
	/** Newest first. */
	runs: DigestRun[];
	/** Oldest first: the Gate that waited longest on top. */
	gates: DigestGate[];
	/** The failed sources first, then the ones that are out of date. */
	sources: DigestKnowledgeSource[];
};

/** What a digest reads: the runs of a Space that ended, its open Gates and its knowledge sources. */
export type DigestSource = {
	/** The runs of the Space that ended after `since`, newest first. */
	endedRuns(spaceId: string, since: number): Promise<EndedRun[]>;
	/** The Gates of the Space that wait for an answer. */
	waitingGates(spaceId: string): Promise<WaitingGate[]>;
	/** The knowledge sources of the Space whose last sync needs a person. Without it: none. */
	sourceProblems?(spaceId: string): Promise<SourceProblem[]>;
};

const DAY_MS = 24 * 60 * 60_000;
/** The first digest, and one after a long pause, looks back this far at most. */
const FIRST_LOOK_BACK_MS = DAY_MS;
const MAX_LOOK_BACK_MS = 7 * DAY_MS;
/** A reason longer than this is cut: the run's page has all of it. */
const REASON_CHARS = 140;

/**
 * Where a digest at `at` starts: at the last digest, or a day back for the
 * first one. Never more than a week back.
 */
export function digestFrom(lastAt: number | null, at: number): number {
	return Math.max(lastAt ?? at - FIRST_LOOK_BACK_MS, at - MAX_LOOK_BACK_MS);
}

type CostBasis = NonNullable<RunSummary["metrics"]>["costBasis"];

/** How sure a run's cost is. Null: nothing in it could cost. */
function basisOf(run: EndedRun): CostBasis | null {
	if (run.costCalls === 0 && run.costUsd === 0) return null;
	if (run.metrics) return run.metrics.costBasis;
	if (run.costMissing > 0) return "unknown";
	return run.costEstimated ? "estimated" : "billed";
}

function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

/** A cost with how sure it is. Null: nothing could cost. */
function costText(usd: number, basis: CostBasis | null): string | null {
	switch (basis) {
		case null:
			return null;
		case "unknown":
			return usd > 0 ? `at least ${dollars(usd)}` : "cost unknown";
		case "estimated":
			return `about ${dollars(usd)}`;
		case "billed":
			return dollars(usd);
	}
}

function statusText(run: EndedRun): string {
	switch (run.status) {
		case "finished":
			return run.result === "nothing-to-do" ? "Nothing to do" : "Finished";
		case "failed":
			return "Failed";
		case "stopped":
			return "Stopped";
		case "interrupted":
			return "Interrupted";
		default:
			return "Ended";
	}
}

/**
 * The words of a warning a person needs in the digest. Kinds are an open
 * list: a kind not here says nothing. `cost-unknown` shows in the cost.
 */
const WARNING_WORDS: Record<string, string> = {
	budget: "reached its budget or turn limit",
	stalled: "an agent went quiet",
	looping: "an agent repeated itself",
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function oneLine(text: string, chars: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > chars ? `${line.slice(0, chars - 1).trimEnd()}…` : line;
}

/** A quick run is titled by its prompt. */
function titleOf(run: Pick<EndedRun, "flowName" | "title">): string {
	if (run.flowName) return run.title;
	return `Quick run · ${oneLine(run.title, 60)}`;
}

function runLine(run: EndedRun): DigestRun {
	const prUrl = run.metrics?.prUrl ?? null;
	const reason =
		prUrl === null && run.reason ? oneLine(run.reason, REASON_CHARS) : null;
	const warnings = [
		...new Set(
			run.warnings.flatMap((w) => {
				const words = WARNING_WORDS[w.kind as string];
				return words ? [words] : [];
			}),
		),
	];
	const parts = [
		tokensText(run.metrics?.tokens),
		costText(run.costUsd, basisOf(run)),
		reason,
		...warnings,
	]
		.filter((part): part is string => part !== null && part !== "")
		.map(capital);
	const detail = parts.join(" · ");
	return {
		runId: run.id,
		spaceId: run.spaceId,
		title: titleOf(run),
		status: run.status,
		statusText: statusText(run),
		detail: detail || null,
		prUrl,
		endedAt: run.endedAt,
	};
}

const plural = (count: number, one: string, many: string) =>
	count === 1 ? `1 ${one}` : `${count} ${many}`;

/** "3 runs finished, 1 failed, 1 stopped." */
function runsSentence(runs: readonly EndedRun[]): string | null {
	const count = (match: (run: EndedRun) => boolean) =>
		runs.filter(match).length;
	const groups = [
		{ count: count((r) => r.status === "finished"), verb: "finished" },
		{ count: count((r) => r.status === "failed"), verb: "failed" },
		{
			count: count((r) => r.status !== "finished" && r.status !== "failed"),
			verb: "stopped",
		},
	].filter((group) => group.count > 0);
	const [first, ...rest] = groups;
	if (!first) return null;
	return `${[
		`${plural(first.count, "run", "runs")} ${first.verb}`,
		...rest.map((group) => `${group.count} ${group.verb}`),
	].join(", ")}.`;
}

/** "$4.20 spent.", "About $4.20 spent on 12.3K tokens.", "Cost unknown." */
function costSentence(runs: readonly EndedRun[]): string | null {
	const bases = runs.map(basisOf);
	if (bases.every((basis) => basis === null)) return null;
	const total = runs.reduce((sum, run) => sum + run.costUsd, 0);
	const used = runs.reduce(
		(sum, run) =>
			sum +
			(run.metrics ? run.metrics.tokens.input + run.metrics.tokens.output : 0),
		0,
	);
	const tokens = used > 0 ? `${compact(used)} tokens` : null;
	const text = bases.includes("unknown")
		? costText(total, "unknown")
		: bases.includes("estimated")
			? costText(total, "estimated")
			: costText(total, "billed");
	if (!text) return tokens ? `${capital(tokens)} used.` : null;
	if (text === "cost unknown") {
		return tokens ? `Cost unknown. ${capital(tokens)} used.` : "Cost unknown.";
	}
	return `${capital(text)} spent${tokens ? ` on ${tokens}` : ""}.`;
}

/**
 * A short count, the same words as the screens: "950", "12.3K", "1.2M".
 */
function compact(count: number): string {
	const round = (value: number) =>
		value < 100
			? String(Math.round(value * 10) / 10)
			: String(Math.round(value));
	if (count < 1000) return String(Math.round(count));
	if (count < 999_500) return `${round(count / 1000)}K`;
	return `${round(count / 1_000_000)}M`;
}

/** "12.3K tokens". Null when none were used. */
function tokensText(
	tokens: { input: number; output: number } | null | undefined,
): string | null {
	const used = tokens ? tokens.input + tokens.output : 0;
	return used > 0 ? `${compact(used)} tokens` : null;
}

/** "Night Shift: last night" for a morning digest, else "Night Shift: your digest". */
export function digestTitle(time: string | null): string {
	const hour = time ? Number(time.slice(0, 2)) : 0;
	return hour < 12 ? "Night Shift: last night" : "Night Shift: your digest";
}

/** "1 knowledge source did not sync. 2 have not synced in a week." */
function sourcesSentence(
	sources: readonly KnowledgeSourceProblem[],
): string | null {
	const failed = sources.filter((s) => s.health === "failed").length;
	const stale = sources.length - failed;
	const parts = [
		failed > 0
			? `${plural(failed, "knowledge source", "knowledge sources")} did not sync.`
			: null,
		stale > 0
			? failed > 0
				? `${stale} ${stale === 1 ? "has" : "have"} not synced in a week.`
				: `${plural(stale, "knowledge source has", "knowledge sources have")} not synced in a week.`
			: null,
	].filter((part): part is string => part !== null);
	return parts.length > 0 ? parts.join(" ") : null;
}

function sourceLine(source: KnowledgeSourceProblem): DigestKnowledgeSource {
	return {
		spaceId: source.spaceId,
		projectId: source.projectId,
		title: `${source.label} · ${source.projectName}`,
		statusText:
			source.health === "failed" ? "Last sync failed" : "Not synced in a week",
		runId: source.lastRun.id,
	};
}

/**
 * The digest of these runs, Gates and knowledge sources. Only the runs
 * that ended after `from` and by `to` count. Null: no run ended, no Gate
 * waits and no source failed.
 */
export function digestOf(input: {
	runs: readonly EndedRun[];
	gates: readonly WaitingGate[];
	sources?: readonly KnowledgeSourceProblem[];
	from: number;
	to: number;
	/** The time of day the digest goes out (`digestTime`): it picks the title. */
	time: string | null;
}): Digest | null {
	const runs = input.runs
		.filter((run) => run.endedAt > input.from && run.endedAt <= input.to)
		.sort((a, b) => b.endedAt - a.endedAt);
	const sources = [...(input.sources ?? [])].sort(
		(a, b) =>
			Number(b.health === "failed") - Number(a.health === "failed") ||
			a.projectName.localeCompare(b.projectName) ||
			a.label.localeCompare(b.label),
	);
	const failedSources = sources.some((s) => s.health === "failed");
	if (runs.length === 0 && input.gates.length === 0 && !failedSources) {
		return null;
	}
	const gates = input.gates.length
		? `${input.gates.length === 1 ? "1 Gate waits" : `${input.gates.length} Gates wait`} for you.`
		: null;
	const body = [
		runsSentence(runs),
		costSentence(runs),
		gates,
		sourcesSentence(sources),
	]
		.filter((part): part is string => part !== null)
		.join(" ");
	return {
		from: input.from,
		to: input.to,
		title: digestTitle(input.time),
		body,
		runs: runs.map(runLine),
		gates: input.gates.map((gate) => ({
			spaceId: gate.spaceId,
			runId: gate.runId,
			stepId: gate.stepId,
			title: titleOf({ flowName: gate.flowName, title: gate.runTitle }),
		})),
		sources: sources.map(sourceLine),
	};
}

/** Reads the digest of these Spaces from the source. Null: nothing to say. */
export async function readDigest(
	source: DigestSource,
	spaceIds: readonly string[],
	window: { from: number; to: number; time: string | null },
): Promise<Digest | null> {
	const runs: EndedRun[] = [];
	const gates: WaitingGate[] = [];
	const sources: KnowledgeSourceProblem[] = [];
	for (const spaceId of spaceIds) {
		runs.push(...(await source.endedRuns(spaceId, window.from)));
		gates.push(...(await source.waitingGates(spaceId)));
		const problems = (await source.sourceProblems?.(spaceId)) ?? [];
		sources.push(...problems.map((problem) => ({ ...problem, spaceId })));
	}
	return digestOf({ runs, gates, sources, ...window });
}
