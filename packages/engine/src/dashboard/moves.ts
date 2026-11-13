import type { RunDetail } from "../read";

type StepSummary = RunDetail["steps"][number];

import type { FlowMove, MoveGuard, MoveSetupCause } from "./types";

/**
 * The next changes to try on a flow (Q15, docs/research/dashboards-2026-11.md),
 * read from the steps of its recent runs: where runs stop or loop, where a
 * person answers the same way or sends the work back, where runs wait for
 * a person, and what the setup broke. Each move names the newest run that
 * shows it. Nothing here changes a flow: a person picks a move, and an
 * agent proposes the change.
 */

/** How many of the newest runs of the days the moves read. */
export const MOVE_RUNS = 30;

/** A person gave the same answer this share of the times or more. */
const SAME_ANSWER_SHARE = 0.8;
/** The fewest answers of a person that make a pattern. */
const MIN_ANSWERS = 4;
/** Runs waited for a person this share of their time or more. */
const WAIT_SHARE = 0.4;
/** A step ran this many rounds per run or more. */
const LOOP_ROUNDS = 1.5;
/** A model was unsure on this share of its choices or more. */
const UNSURE_SHARE = 0.5;
/** A scheduled run that started this much after its time started late. */
const LATE_MS = 15 * 60_000;
/** Fewer runs: no pattern over the runs (rate, nothing). */
const MIN_RUNS = 5;

/** The ends of a run that no change of the flow fixes: the setup. */
const SETUP_ENDS = {
	"agent.usage_limit": "usageLimit",
	"agent.network": "network",
	"agent.signed_out": "signedOut",
} as const;
/** How a hand-off between Devices fails (`step-runner.ts`). */
const HANDOFF_FAILED = "could not take the run's work";

const GUARD_ENDS: Record<string, MoveGuard> = {
	"guard.budget": "budget",
	"guard.turns": "turns",
	"guard.looping": "looping",
	"guard.max_steps": "max_steps",
};

type Weighted = { weight: number; move: FlowMove };

function topLevel(run: RunDetail): StepSummary[] {
	return run.steps.filter((step) => step.scope === null);
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function bump(map: Map<string, number>, key: string) {
	map.set(key, (map.get(key) ?? 0) + 1);
}

/** Counts by key, and the newest run that shows each. */
class Tally {
	readonly counts = new Map<string, { n: number; runId: string }>();
	add(key: string, runId: string) {
		const entry = this.counts.get(key) ?? { n: 0, runId };
		entry.n++;
		entry.runId = runId;
		this.counts.set(key, entry);
	}
}

/** How the runs ended: on an outcome no path leaves, at a loop's end, or in the setup. */
function endMoves(runs: readonly RunDetail[]): Weighted[] {
	const edges = new Tally();
	const limits = new Tally();
	const setup = new Tally();
	const guards = new Tally();
	for (const run of runs) {
		const setupEnd =
			SETUP_ENDS[run.endReason as keyof typeof SETUP_ENDS] ??
			(run.steps.some((step) => step.error?.includes(HANDOFF_FAILED))
				? "handoff"
				: undefined);
		if (setupEnd) {
			setup.add(setupEnd, run.id);
			continue;
		}
		const guard = run.endReason ? GUARD_ENDS[run.endReason] : undefined;
		if (guard) guards.add(guard, run.id);
		if (run.status !== "failed") continue;
		const last = topLevel(run).at(-1);
		// An End node ends the run on purpose: no edge leaves it.
		if (!last?.outcome || last.error || last.nodeType === "end") continue;
		const leaving = run.flow.edges.filter(
			(edge) => edge.from === last.nodeId && edge.outcome === last.outcome,
		);
		const key = `${last.nodeId}\n${last.outcome}`;
		if (leaving.length === 0) edges.add(key, run.id);
		else if (leaving.every((edge) => edge.max !== undefined)) {
			limits.add(key, run.id);
		}
	}
	const out: Weighted[] = [];
	for (const [key, { n, runId }] of edges.counts) {
		const [nodeId = "", outcome = ""] = key.split("\n");
		out.push({
			weight: 90 + n,
			move: { kind: "edge", nodeId, outcome, runs: n, runId },
		});
	}
	for (const [key, { n, runId }] of limits.counts) {
		const [nodeId = "", outcome = ""] = key.split("\n");
		out.push({
			weight: 70 + n,
			move: { kind: "loopLimit", nodeId, outcome, runs: n, runId },
		});
	}
	for (const [cause, { n, runId }] of setup.counts) {
		out.push({
			weight: 80 + n,
			move: {
				kind: "setup",
				cause: cause as MoveSetupCause,
				runs: n,
				runId,
			},
		});
	}
	for (const [guard, { n, runId }] of guards.counts) {
		out.push({
			weight: 62 + n,
			move: { kind: "guard", guard: guard as MoveGuard, runs: n, runId },
		});
	}
	return out;
}

type GateTally = {
	nodeId: string;
	asked: number;
	answers: Map<string, number>;
	byPerson: number;
	open: number;
	notes: string[];
	/** How long it waited for a person, over all the times it asked: answered or not. */
	waited: number;
	deadline: boolean;
	step: string | null;
	runId: string;
};

/** What happened at each Gate: the answers of a person, the notes, the waits. */
function gateTallies(runs: readonly RunDetail[]): GateTally[] {
	const gates = new Map<string, GateTally>();
	for (const run of runs) {
		const steps = topLevel(run);
		steps.forEach((step, index) => {
			if (!step.gate) return;
			const gate: GateTally = gates.get(step.nodeId) ?? {
				nodeId: step.nodeId,
				asked: 0,
				answers: new Map(),
				byPerson: 0,
				open: 0,
				notes: [],
				waited: 0,
				deadline: false,
				step: null,
				runId: run.id,
			};
			gate.asked++;
			gate.runId = run.id;
			gate.deadline ||= step.gate.deadline !== null;
			const by = run.gates.find(
				(asked) => asked.openedAt === step.gate?.openedAt,
			)?.answeredBy;
			const closedAt = step.endedAt ?? run.endedAt;
			if (closedAt !== null) gate.waited += closedAt - step.gate.openedAt;
			if (!step.outcome) gate.open++;
			else if (by === "person") {
				gate.byPerson++;
				bump(gate.answers, step.outcome);
				const note = step.outputs.note;
				if (typeof note === "string" && note.trim()) gate.notes.push(note);
			}
			const judged = steps
				.slice(0, index)
				.reverse()
				.find((before) => before.nodeType === "agent");
			if (judged) gate.step = judged.nodeId;
			gates.set(step.nodeId, gate);
		});
	}
	return [...gates.values()];
}

function gateMoves(runs: readonly RunDetail[]): Weighted[] {
	const out: Weighted[] = [];
	const gates = gateTallies(runs);
	for (const gate of gates) {
		const [choice, times] = [...gate.answers].sort(
			(a, b) => b[1] - a[1],
		)[0] ?? ["", 0];
		if (
			gate.byPerson >= MIN_ANSWERS &&
			times / gate.byPerson >= SAME_ANSWER_SHARE
		) {
			out.push({
				weight: 75 + times,
				move: {
					kind: "sameAnswer",
					nodeId: gate.nodeId,
					choice,
					times,
					of: gate.byPerson,
					deadline: gate.deadline,
					runId: gate.runId,
				},
			});
		} else if (gate.notes.length >= 2) {
			out.push({
				weight: 65 + gate.notes.length,
				move: {
					kind: "notes",
					nodeId: gate.nodeId,
					step: gate.step,
					notes: gate.notes.length,
					lastNote: gate.notes.at(-1) ?? "",
					runId: gate.runId,
				},
			});
		}
		if (gate.open >= 3 && gate.open * 2 >= gate.asked) {
			out.push({
				weight: 55 + gate.open,
				move: {
					kind: "leftOpen",
					nodeId: gate.nodeId,
					open: gate.open,
					asked: gate.asked,
					runId: gate.runId,
				},
			});
		}
	}

	let wall = 0;
	let wait = 0;
	let agent = 0;
	for (const run of runs) {
		wall += run.metrics?.wallMs ?? 0;
		wait += run.metrics?.gateWaitMs ?? 0;
		agent += run.metrics?.agentMs ?? 0;
	}
	if (wall > 0 && wait / wall >= WAIT_SHARE) {
		const longest = [...gates].sort((a, b) => b.waited - a.waited)[0];
		// A Gate is named only when it holds most of the wait.
		const named = longest && longest.waited * 2 >= wait ? longest : null;
		out.push({
			weight: 50,
			move: {
				kind: "wait",
				nodeId: named?.nodeId ?? null,
				share: wait / wall,
				waitMs: named ? named.waited / named.asked : wait / runs.length,
				workMs: agent,
				runId: named?.runId ?? runs.at(-1)?.id ?? "",
			},
		});
	}
	return out;
}

/** The steps that loop or end runs, and the agents that stalled. */
function stepMoves(runs: readonly RunDetail[]): Weighted[] {
	type StepTally = {
		nodeType: string;
		runs: number;
		visits: number;
		failed: number;
		endedHere: number;
		costUsd: number;
		backFrom: Map<string, number>;
		runId: string;
	};
	const steps = new Map<string, StepTally>();
	const stalled = new Tally();
	for (const run of runs) {
		const walked = topLevel(run);
		const firstAt = new Map<string, number>();
		walked.forEach((step, index) => {
			if (!firstAt.has(step.nodeId)) firstAt.set(step.nodeId, index);
		});
		const seen = new Set<string>();
		walked.forEach((step, index) => {
			const tally: StepTally = steps.get(step.nodeId) ?? {
				nodeType: step.nodeType,
				runs: 0,
				visits: 0,
				failed: 0,
				endedHere: 0,
				costUsd: 0,
				backFrom: new Map(),
				runId: run.id,
			};
			if (!seen.has(step.nodeId)) tally.runs++;
			seen.add(step.nodeId);
			tally.visits++;
			tally.costUsd += step.costUsd;
			tally.runId = run.id;
			// An outcome on a path is a branch the flow draws: only an error fails.
			if (step.error) tally.failed++;
			// A loop back: the step before started after this one first did, or
			// is this one. A step that only follows a loop is no loop of its own.
			const before = walked[index - 1];
			if (
				step.visit > 1 &&
				before &&
				!before.gate &&
				(before.nodeId === step.nodeId ||
					(firstAt.get(before.nodeId) ?? 0) > (firstAt.get(step.nodeId) ?? 0))
			) {
				bump(tally.backFrom, `${before.nodeId}\n${before.outcome ?? ""}`);
			}
			steps.set(step.nodeId, tally);
		});
		const last = walked.at(-1);
		if (last && run.status !== "finished") {
			const tally = steps.get(last.nodeId);
			if (tally) tally.endedHere++;
		}
		const stalledNodes = new Set(
			run.warnings
				.filter((warning) => warning.kind === "stalled" && warning.nodeId)
				.map((warning) => warning.nodeId as string),
		);
		for (const nodeId of stalledNodes) stalled.add(nodeId, run.id);
	}

	const out: Weighted[] = [];
	for (const [nodeId, tally] of steps) {
		if (tally.nodeType === "end" || tally.runs < 3) continue;
		const rounds = tally.visits / tally.runs;
		const back = [...tally.backFrom].sort((a, b) => b[1] - a[1])[0];
		if (rounds >= LOOP_ROUNDS && back) {
			const [key, times] = back;
			const [from = "", outcome = ""] = key.split("\n");
			out.push({
				weight: 45 + tally.visits - tally.runs,
				move: {
					kind: "loop",
					nodeId,
					from,
					outcome,
					times,
					rounds,
					extraUsd:
						(tally.costUsd / tally.visits) * (tally.visits - tally.runs),
					runId: tally.runId,
				},
			});
		}
		const broke = Math.max(tally.failed, tally.endedHere);
		if (
			tally.nodeType !== "decision" &&
			broke >= 2 &&
			broke * 5 >= tally.runs
		) {
			out.push({
				weight: 58 + broke,
				move: {
					kind: "endsRuns",
					nodeId,
					runs: broke,
					of: tally.runs,
					agent: tally.nodeType === "agent",
					runId: tally.runId,
				},
			});
		}
	}
	for (const [nodeId, { n, runId }] of stalled.counts) {
		if (n < 2) continue;
		out.push({
			weight: 40 + n,
			move: { kind: "stalled", nodeId, runs: n, runId },
		});
	}
	return out;
}

/** The choices a model made, and how sure it was. */
function deciderMoves(runs: readonly RunDetail[]): Weighted[] {
	const models = new Map<
		string,
		{ picked: number; unsure: number; tier: string | null; runId: string }
	>();
	for (const run of runs) {
		for (const row of run.metrics?.ladder ?? []) {
			if (row.ladder !== "choice" || row.by !== "model") continue;
			const tally = models.get(row.nodeId) ?? {
				picked: 0,
				unsure: 0,
				tier: row.tier,
				runId: run.id,
			};
			tally.picked += row.picked ?? 0;
			tally.unsure += row.unsure ?? 0;
			tally.runId = run.id;
			models.set(row.nodeId, tally);
		}
	}
	const out: Weighted[] = [];
	for (const [nodeId, tally] of models) {
		if (tally.picked < 3 || tally.unsure / tally.picked < UNSURE_SHARE) {
			continue;
		}
		out.push({
			weight: 60 + tally.unsure,
			move: { kind: "unsure", nodeId, ...tally },
		});
	}
	return out;
}

/** Over all the runs: when they started, whether people rate them, whether they find work. */
function runMoves(runs: readonly RunDetail[]): Weighted[] {
	const out: Weighted[] = [];
	const newest = runs.at(-1)?.id ?? "";
	const late: number[] = [];
	let scheduled = 0;
	let lateRun = newest;
	let rated = 0;
	let useful = 0;
	let nothing = 0;
	for (const run of runs) {
		if (run.trigger.kind === "schedule") {
			scheduled++;
			const by = run.createdAt - run.trigger.at;
			if (by > LATE_MS) {
				late.push(by);
				lateRun = run.id;
			}
		}
		const answer = (run.metrics?.scores ?? [])
			.filter((score) => score.score === "useful")
			.at(-1);
		if (answer) {
			rated++;
			if (answer.value > 0) useful++;
		}
		if (run.result === "nothing-to-do") nothing++;
	}
	if (late.length >= 2) {
		out.push({
			weight: 33,
			move: {
				kind: "late",
				late: late.length,
				scheduled,
				usualMs: median(late),
				runId: lateRun,
			},
		});
	}
	if (runs.length >= MIN_RUNS && rated * 10 < runs.length * 3) {
		out.push({
			weight: 35,
			move: { kind: "rate", rated, useful, runs: runs.length, runId: newest },
		});
	}
	if (runs.length >= MIN_RUNS && nothing * 2 >= runs.length) {
		out.push({
			weight: 28,
			move: { kind: "nothing", nothing, runs: runs.length, runId: newest },
		});
	}
	return out;
}

/**
 * The next changes to try, the most pressing first, from the steps of a
 * flow's own ended runs (oldest first, at most {@link MOVE_RUNS}).
 */
export function nextMoves(runs: readonly RunDetail[]): FlowMove[] {
	if (runs.length === 0) return [];
	const ends = endMoves(runs);
	// A step whose outcome has no path, or whose loop ran out, says why it
	// ended runs: no second move for it.
	const explained = new Set(
		ends.flatMap(({ move }) =>
			move.kind === "edge" || move.kind === "loopLimit" ? [move.nodeId] : [],
		),
	);
	return [
		...ends,
		...gateMoves(runs),
		...stepMoves(runs).filter(
			({ move }) => !(move.kind === "endsRuns" && explained.has(move.nodeId)),
		),
		...deciderMoves(runs),
		...runMoves(runs),
	]
		.sort((a, b) => b.weight - a.weight)
		.map((weighted) => weighted.move);
}
