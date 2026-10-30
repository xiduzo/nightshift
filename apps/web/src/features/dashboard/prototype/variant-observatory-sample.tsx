/**
 * PROTOTYPE, throw away. Invented numbers for the Observatory variant: what
 * the run metrics read model, guards, feedback scores and token counts of
 * the monitoring proposal would show. Deterministic: the same flow name and
 * range always give the same numbers.
 */

import type { DashboardRange } from "./range-bar";

/** A stable number in [0, 1) from a string, so sample data does not jump between renders. */
export function seeded(key: string): number {
	let hash = 2166136261;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return ((hash >>> 0) % 10_000) / 10_000;
}

/** How many nights a range covers; the last 24 hours count as one. */
export function nightsIn(range: DashboardRange): number {
	return range === "24h" ? 1 : range;
}

/** Flows to show when the project has no flow health yet. */
export const SAMPLE_FLOWS = [
	"nightly-bugfix",
	"green-pipelines",
	"nightly-e2e-fix",
	"sprint-demo-slide",
	"feature-factory",
];

/** How spend splits over models. Shares add up to 1. */
export const MODEL_SHARES = [
	{ key: "opus", label: "Claude Opus", share: 0.58, color: "var(--chart-1)" },
	{
		key: "sonnet",
		label: "Claude Sonnet",
		share: 0.31,
		color: "var(--chart-2)",
	},
	{ key: "codex", label: "Codex", share: 0.08, color: "var(--chart-3)" },
	{ key: "local", label: "Local models", share: 0.03, color: "var(--chart-4)" },
] as const;

/** Tokens per US dollar of spend, by type: a rough blend over the models above. */
const TOKENS_PER_USD = {
	input: 52_000,
	output: 9_500,
	cacheRead: 410_000,
	cacheWrite: 31_000,
};

export function sampleTokens(spendUsd: number) {
	return [
		{
			type: "Input",
			tokens: Math.round(spendUsd * TOKENS_PER_USD.input),
			fill: "var(--chart-1)",
		},
		{
			type: "Output",
			tokens: Math.round(spendUsd * TOKENS_PER_USD.output),
			fill: "var(--chart-2)",
		},
		{
			type: "Cache read",
			tokens: Math.round(spendUsd * TOKENS_PER_USD.cacheRead),
			fill: "var(--chart-3)",
		},
		{
			type: "Cache write",
			tokens: Math.round(spendUsd * TOKENS_PER_USD.cacheWrite),
			fill: "var(--chart-4)",
		},
	];
}

/** Budgets and how often each guard stopped a run of the flow. */
export function sampleGuards(flow: string, range: DashboardRange) {
	const nights = nightsIn(range);
	const r = seeded(flow);
	const cap = [2, 5, 5, 10, 50][Math.floor(r * 5)] ?? 5;
	const scale = (rate: number, salt: string) =>
		Math.round(nights * rate * seeded(`${flow}:${salt}`));
	return {
		cap,
		budgetStops: scale(0.15, "budget"),
		stalls: scale(0.1, "stall"),
		loops: scale(0.06, "loop"),
		turns: scale(0.12, "turns"),
	};
}

const STEPS = [
	"plan",
	"fix",
	"run tests",
	"review",
	"open pull request",
	"bugs",
	"branch",
];

/** The steps of the flows that cost the most time, money or failures. */
export function sampleHotSpots(flows: string[], range: DashboardRange) {
	const nights = nightsIn(range);
	return flows
		.flatMap((flow) =>
			STEPS.slice(0, 3 + Math.floor(seeded(flow) * 3)).map((step) => {
				const r = seeded(`${flow}/${step}`);
				const maxRetries = 3;
				return {
					flow,
					step,
					minutes: Math.round(2 + r * 38),
					costUsd: Math.round((0.05 + r * 3.2) * 100) / 100,
					runs: Math.max(1, Math.round(nights * (0.4 + r))),
					retries: Math.round(r * 2.4 * 10) / 10,
					maxRetries,
					failShare: Math.round(r * r * 60),
				};
			}),
		)
		.sort((a, b) => b.failShare - a.failShare || b.costUsd - a.costUsd)
		.slice(0, 8);
}

/** What happened to the pull requests the runs of a flow opened, and how people answered its Gates. */
export function sampleOutcomes(flow: string, range: DashboardRange) {
	const nights = nightsIn(range);
	const r = seeded(`${flow}#pr`);
	const opened = Math.max(1, Math.round(nights * (0.3 + r * 0.8)));
	const merged = Math.round(opened * (0.35 + r * 0.5));
	const reverted = Math.min(merged, Math.round(opened * 0.08 * seeded(flow)));
	const closed = Math.max(0, opened - merged - Math.round(opened * 0.1));
	const gates = Math.round(nights * seeded(`${flow}#gates`) * 0.9);
	const approved = Math.round(gates * (0.5 + r * 0.45));
	return { opened, merged, closed, reverted, gates, approved };
}
