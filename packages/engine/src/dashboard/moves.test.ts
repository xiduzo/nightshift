import { describe, expect, test } from "bun:test";
import type { RunDetail } from "../read";
import { nextMoves } from "./moves";

/*
 * The next changes to try, read from the steps of a flow's runs. Each test
 * builds the runs of one flow as the steps they walked.
 */

type Step = RunDetail["steps"][number];
type Edge = RunDetail["flow"]["edges"][number];

let next = 0;
let clock = 1_000_000;

/** One step: `nodeId` that ended on `outcome`. */
function step(
	nodeId: string,
	outcome: string | null,
	more: Partial<Step> = {},
): Step {
	clock += 60_000;
	return {
		id: `step-${clock}`,
		nodeId,
		nodeType: "agent",
		visit: 1,
		startedAt: clock - 60_000,
		endedAt: clock,
		outcome,
		outputs: {},
		error: null,
		scope: null,
		items: [],
		sessions: [],
		costUsd: 0,
		costEstimated: false,
		costMissing: 0,
		costCalls: 0,
		device: null,
		gate: null,
		...more,
	} as Step;
}

/** A Gate at `nodeId` that a person answered with `answer`, after `waitMs`. */
function gate(
	nodeId: string,
	answer: string | null,
	more: { note?: string; deadline?: boolean; waitMs?: number } = {},
): { step: Step; asked: RunDetail["gates"][number] } {
	const openedAt = clock;
	const closedAt = openedAt + (more.waitMs ?? 60_000);
	const asked = step(nodeId, answer, { nodeType: "decision" });
	clock = closedAt;
	return {
		step: {
			...asked,
			startedAt: openedAt,
			endedAt: answer === null ? null : closedAt,
			outputs: more.note ? { note: more.note } : {},
			gate: {
				question: "Go on?",
				choices: [],
				openedAt,
				deadline: more.deadline ? { at: clock + 1, choose: "go" } : null,
			},
		} as Step,
		asked: {
			openedAt,
			closedAt: answer === null ? null : closedAt,
			answeredBy: answer === null ? null : "person",
		},
	};
}

/** A run of the flow with `edges` that walked `steps`. */
function run(
	steps: (Step | ReturnType<typeof gate>)[],
	more: Partial<RunDetail> & { edges?: Edge[] } = {},
): RunDetail {
	next += 1;
	const { edges = [], ...fields } = more;
	return {
		id: `run-${next}`,
		flowName: "night",
		status: "finished",
		result: "done",
		endReason: "finished",
		createdAt: clock,
		trigger: { kind: "manual" },
		warnings: [],
		resumes: [],
		flow: { edges } as unknown as RunDetail["flow"],
		steps: steps.map((s) => ("step" in s ? s.step : s)),
		gates: steps.flatMap((s) => ("asked" in s ? [s.asked] : [])),
		...fields,
	} as RunDetail;
}

const edge = (
	from: string,
	outcome: string,
	to: string,
	max?: number,
): Edge => ({
	id: `${from}-${outcome}`,
	from,
	outcome,
	to,
	...(max ? { max } : {}),
});

describe("where runs stop", () => {
	test("an outcome no path leaves stops runs: draw where it goes", () => {
		const runs = [1, 2].map(() =>
			run([step("branch", "failed")], {
				status: "failed",
				edges: [edge("branch", "ready", "build")],
			}),
		);
		expect(nextMoves(runs)[0]).toMatchObject({
			kind: "edge",
			nodeId: "branch",
			outcome: "failed",
			runs: 2,
			runId: runs[1]?.id,
		});
		// The same step does not show again as a step that ends runs.
		expect(nextMoves(runs).some((move) => move.kind === "endsRuns")).toBe(
			false,
		);
	});

	test("an End node that ends a run as failed is the flow's own choice", () => {
		const moves = nextMoves([
			run(
				[
					step("branch", "failed"),
					step("give_up", "failed", { nodeType: "end" }),
				],
				{
					status: "failed",
					edges: [edge("branch", "failed", "give_up")],
				},
			),
		]);
		expect(moves.some((move) => move.kind === "edge")).toBe(false);
	});

	test("an outcome whose paths all reached their max: a loop ran out of rounds", () => {
		const moves = nextMoves([
			run([step("slide", "capture")], {
				status: "failed",
				edges: [edge("slide", "capture", "place", 4)],
			}),
		]);
		expect(moves[0]).toMatchObject({ kind: "loopLimit", nodeId: "slide" });
	});

	test("a usage limit or a failed hand-off is the setup, not the flow", () => {
		const moves = nextMoves([
			run([step("spec", null)], {
				status: "failed",
				endReason: "agent.usage_limit",
			}),
			run(
				[
					step("spec", null, {
						error: "host could not take the run's work from laptop.",
					}),
				],
				{ status: "failed", endReason: "_OTHER" },
			),
		]);
		expect(moves.map((move) => move.kind === "setup" && move.cause)).toEqual(
			expect.arrayContaining(["usageLimit", "handoff"]),
		);
	});

	test("a guard that stopped runs", () => {
		const moves = nextMoves([
			run([step("fix", null)], {
				status: "failed",
				endReason: "guard.looping",
			}),
		]);
		expect(moves[0]).toMatchObject({
			kind: "guard",
			guard: "looping",
			runs: 1,
		});
	});
});

describe("what a person does at a Gate", () => {
	test("the same answer 4 of 5 times or more: let it go on", () => {
		const runs = [1, 2, 3, 4].map(() => run([gate("review", "ready")]));
		expect(nextMoves(runs)[0]).toMatchObject({
			kind: "sameAnswer",
			nodeId: "review",
			choice: "ready",
			times: 4,
			of: 4,
			deadline: false,
		});
	});

	test("answers that vary, with notes: the work before the Gate needs better instructions", () => {
		const runs = [
			run([
				step("slide", "written"),
				gate("review", "change", { note: "add the screenshots" }),
			]),
			run([step("slide", "written"), gate("review", "approve")]),
			run([
				step("slide", "written"),
				gate("review", "change", { note: "too long" }),
			]),
		];
		expect(nextMoves(runs)).toContainEqual(
			expect.objectContaining({
				kind: "notes",
				nodeId: "review",
				step: "slide",
				notes: 2,
				lastNote: "too long",
			}),
		);
	});

	test("runs that ended while a Gate waited", () => {
		const runs = [1, 2, 3].map(() =>
			run([gate("review", null)], { status: "stopped", result: null }),
		);
		expect(nextMoves(runs)).toContainEqual(
			expect.objectContaining({ kind: "leftOpen", open: 3, asked: 3 }),
		);
	});

	test("runs that waited most of their time: the Gate that waited longest", () => {
		const runs = [1, 2].map(() =>
			run([gate("approve", "go", { waitMs: 3 * 60 * 60_000 })], {
				metrics: {
					wallMs: 4 * 60 * 60_000,
					agentMs: 60 * 60_000,
					gateWaitMs: 3 * 60 * 60_000,
				} as RunDetail["metrics"],
			}),
		);
		expect(nextMoves(runs)).toContainEqual(
			expect.objectContaining({
				kind: "wait",
				nodeId: "approve",
				share: 0.75,
				// Each time it asked.
				waitMs: 3 * 60 * 60_000,
			}),
		);
	});
});

describe("steps that loop", () => {
	test("a loop back counts once, at the step it goes back to", () => {
		// slide → place → capture says "broken" → slide again, three runs.
		const walk = () => [
			step("slide", "capture"),
			step("place", "live", { nodeType: "decision" }),
			step("capture", "broken", { nodeType: "command" }),
			step("slide", "capture", { visit: 2 }),
			step("place", "live", { nodeType: "decision", visit: 2 }),
			step("capture", "taken", { nodeType: "command", visit: 2 }),
		];
		const moves = nextMoves([run(walk()), run(walk()), run(walk())]);
		const loops = moves.filter((move) => move.kind === "loop");
		expect(loops).toHaveLength(1);
		expect(loops[0]).toMatchObject({
			nodeId: "slide",
			from: "capture",
			outcome: "broken",
			times: 3,
			rounds: 2,
		});
	});
});

describe("over all the runs", () => {
	test("few rated runs, and most runs with nothing to do", () => {
		const runs = [1, 2, 3, 4, 5].map((i) =>
			run([step("look", "none")], {
				result: i <= 3 ? "nothing-to-do" : "done",
			}),
		);
		const kinds = nextMoves(runs).map((move) => move.kind);
		expect(kinds).toContain("rate");
		expect(kinds).toContain("nothing");
	});

	test("no runs, no moves", () => {
		expect(nextMoves([])).toEqual([]);
	});
});
