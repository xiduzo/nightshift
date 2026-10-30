/**
 * PROTOTYPE, throw away. What the "Needs you first" variants show, in one
 * small shape: from the real numbers, or from a generous sample so the
 * layout can be judged full. The sample is made up and seeded, so a reload
 * shows the same nights.
 */

import type { NightRange, OpenGate, RunStatus } from "@/shared/api";
import type { MetricRow, MetricValues } from "../metrics";
import { formatNight, formatNightShort } from "../nights";
import type { Metrics, useHomeData } from "./home-data";
import { type LastRun, lastRunsOf } from "./home-parts";

export type NeedsYouGate = {
	key: string;
	question: string;
	projectId: string;
	projectName: string;
	runId: string;
	runTitle: string;
	flowName: string | null;
	openedAt: number;
	choices: string[];
};

export type NeedsYouFailure = {
	id: string;
	title: string;
	project: string;
	flow: string;
	reason: string | null;
	createdAt: number;
};

export type NeedsYouRunning = {
	id: string;
	title: string;
	project: string;
	startedAt: number;
	step: string;
};

export type NeedsYouProject = {
	id: string;
	name: string;
	lastRuns: LastRun[];
	values: MetricValues | undefined;
};

export type NeedsYouData = {
	sample: boolean;
	/** Undefined summary: the details dialogs need the real numbers. */
	summary: ReturnType<typeof useHomeData>["summary"];
	gates: NeedsYouGate[];
	failed: { count: number; rows: NeedsYouFailure[] };
	running: NeedsYouRunning[];
	runningCount: number;
	metrics: Metrics | undefined;
	projects: NeedsYouProject[];
	realGates: OpenGate[];
};

export function needsYouFromHome(
	data: ReturnType<typeof useHomeData>,
): NeedsYouData {
	const failed = data.nights?.runs.failed;
	return {
		sample: false,
		summary: data.summary,
		gates: data.gates.map((gate) => ({
			key: `${gate.runId}-${gate.stepId}`,
			question: gate.question,
			projectId: gate.projectId,
			projectName: gate.projectName,
			runId: gate.runId,
			runTitle: gate.runTitle,
			flowName: gate.flowName,
			openedAt: gate.openedAt,
			choices: gate.choices.map((choice) => choice.name),
		})),
		failed: {
			count: failed?.count ?? 0,
			rows: (failed?.rows ?? []).map((run) => ({
				id: run.id,
				title: run.title,
				project: run.group,
				flow: run.title.split(" ")[0] ?? run.title,
				reason: run.reason,
				createdAt: run.createdAt,
			})),
		},
		running: [],
		runningCount: data.summary?.cards.running ?? 0,
		metrics: data.metrics,
		projects: data.perProject.map((row) => ({
			id: row.project.id,
			name: row.project.name,
			lastRuns: lastRunsOf(row.nights),
			values: row.metrics?.values,
		})),
		realGates: data.gates,
	};
}

// ---------------------------------------------------------------- sample

const HOUR = 3_600_000;
const NIGHT = 24 * HOUR;

const PROJECTS = [
	"storefront",
	"billing-api",
	"mobile-app",
	"docs-site",
	"data-pipeline",
	"design-system",
	"auth-service",
	"marketing-site",
];
const FLOWS = [
	"nightly-bugfix",
	"dependency-bumps",
	"e2e-fix",
	"release-notes",
	"flaky-tests",
	"security-audit",
	"triage-issues",
	"translations",
];
const REASONS = [
	"The tests failed after 3 tries: 4 of 212 tests still fail.",
	"Could not push the branch: the remote rejected it.",
	"The agent reached its usage limit and did not continue.",
	'Node "review" ended with "failed" and no edge leaves it on that outcome.',
	"The build failed: a type error in src/checkout/cart.ts.",
	"A step ran longer than 45 minutes and was stopped.",
	"Could not look up the open issues: the token has expired.",
	null,
];
const QUESTIONS = [
	"Merge the dependency bumps into main?",
	"The fix changes the public API. Open a pull request anyway?",
	"Which release notes do you want: short or detailed?",
	"Three tests are still flaky. Skip them tonight?",
	"The security audit found 2 high issues. Open tickets for them?",
	"Translate the new strings with the agent, or wait for a person?",
];
const STEPS = ["Write the fix", "Run the tests", "Review the change"];

/** A small seeded random source, so the sample stays put on reload. */
function seeded(seed: number) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function sampleNeedsYou(range: NightRange): NeedsYouData {
	const random = seeded(42);
	const pick = <T>(list: readonly T[]): T =>
		list[Math.floor(random() * list.length)] as T;
	const now = Date.now();
	const today = new Date(now);
	today.setHours(12, 0, 0, 0);
	const lastNight = today.getTime() - (now < today.getTime() ? NIGHT : 0);

	// The headline numbers per night: this range and the one before.
	const night = (index: number, busy: number) => {
		const runs = Math.round(8 + busy * 10 + random() * 8);
		const ended = Math.max(0, runs - Math.round(random() * 2));
		const finished = Math.round(ended * (0.68 + random() * 0.28));
		return {
			runs,
			ended,
			finished,
			costUsd: Math.round(runs * (0.6 + random() * 1.8) * 100) / 100,
			gates: Math.round(random() * 5 + busy * 2),
			index,
		};
	};
	const current = Array.from({ length: range }, (_, i) => night(i, i / range));
	const before = Array.from({ length: range }, (_, i) =>
		night(i, (i / range) * 0.6),
	);
	const share = (totals: { finished: number; ended: number }) =>
		totals.ended === 0
			? null
			: Math.round((totals.finished / totals.ended) * 100);
	const valuesOf = (nights: typeof current): MetricValues => {
		const sum = (key: "runs" | "ended" | "finished" | "costUsd" | "gates") =>
			nights.reduce((total, each) => total + each[key], 0);
		return {
			runs: sum("runs"),
			finished: share({ finished: sum("finished"), ended: sum("ended") }),
			spend: Math.round(sum("costUsd") * 100) / 100,
			gates: sum("gates"),
		};
	};
	const rows = current.map((each, index): MetricRow => {
		const start = lastNight - (range - 1 - index) * NIGHT;
		const back = before[index];
		return {
			label: formatNightShort(start),
			title: formatNight(start),
			runs: each.runs,
			finished: share(each),
			spend: each.costUsd,
			gates: each.gates,
			...(back
				? {
						before_runs: back.runs,
						before_finished: share(back),
						before_spend: back.costUsd,
						before_gates: back.gates,
					}
				: {}),
		};
	});

	// About three failures a night, a few causes again and again.
	const failures: NeedsYouFailure[] = Array.from(
		{ length: Math.min(range * 3, 60) },
		(_, index) => {
			const flow = pick(FLOWS);
			return {
				id: `sample-failed-${index}`,
				title: flow,
				project: pick(PROJECTS.slice(0, 6)),
				flow,
				reason: pick(REASONS),
				createdAt: now - index * (NIGHT / 3) - random() * 4 * HOUR,
			};
		},
	);

	const gates: NeedsYouGate[] = QUESTIONS.map((question, index) => {
		const project = PROJECTS[index % PROJECTS.length] ?? "storefront";
		const flow = FLOWS[index % FLOWS.length] ?? "nightly-bugfix";
		return {
			key: `sample-gate-${index}`,
			question,
			projectId: `sample-${project}`,
			projectName: project,
			runId: `sample-gate-run-${index}`,
			runTitle: flow,
			flowName: flow,
			openedAt: now - (index * 2.5 + 0.3) * HOUR,
			choices:
				index % 2 === 0 ? ["Yes", "No"] : ["Open it", "Skip", "Ask again"],
		};
	});

	const running: NeedsYouRunning[] = [0, 1, 2].map((index) => ({
		id: `sample-running-${index}`,
		title: pick(FLOWS),
		project: pick(PROJECTS),
		startedAt: now - (index * 25 + 6) * 60_000,
		step: STEPS[index] ?? "Write the fix",
	}));

	const statuses: RunStatus[] = [
		"finished",
		"finished",
		"finished",
		"finished",
		"failed",
		"interrupted",
		"stopped",
		"waiting",
	];
	const projects: NeedsYouProject[] = PROJECTS.map((name, index) => ({
		id: `sample-${name}`,
		name,
		lastRuns: Array.from(
			{ length: index === 7 ? 0 : 10 - (index % 4) },
			(_, run) => ({
				runId: `sample-${name}-${run}`,
				status: pick(statuses),
				startedAt:
					now - (run + index * 0.7) * NIGHT * 0.6 - random() * 3 * HOUR,
				flow: pick(FLOWS),
			}),
		),
		values:
			index === 7
				? undefined
				: {
						runs: Math.round(20 + random() * 120),
						finished: Math.round(60 + random() * 38),
						spend: Math.round(random() * 9000) / 100,
						gates: Math.round(random() * 30),
					},
	}));

	return {
		sample: true,
		summary: undefined,
		gates,
		failed: { count: failures.length, rows: failures },
		running,
		runningCount: running.length,
		metrics: {
			rows,
			values: valuesOf(current),
			before: valuesOf(before),
			compared: true,
		},
		projects,
		realGates: [],
	};
}
