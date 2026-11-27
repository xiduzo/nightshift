import { describe, expect, test } from "bun:test";
import type { JoinNode } from "@nightshift/flows";
import { scopeKey } from "../../log";
import { command, edge, flowOf } from "../../testing/graph";
import type { JoinRound } from "../state";
import { outrun, unreachableJoin } from "./branches";

/** start → [one, two] → joined. */
const flow = (wait: JoinNode["wait"]) =>
	flowOf(
		[
			command("start", "true"),
			command("one", "true"),
			command("two", "true"),
			{ id: "joined", type: "join", position: { x: 0, y: 0 }, wait },
		],
		[
			edge("s1", "start", "pass", "one"),
			edge("s2", "start", "pass", "two"),
			edge("j1", "one", "pass", "joined"),
			edge("j2", "two", "pass", "joined"),
		],
	);

const round = (
	arrived: string[],
	closed = false,
): { joins: Record<string, JoinRound> } => ({
	joins: {
		joined: {
			round: 1,
			arrived: arrived.map((from, at) => ({ from, at })),
			closed,
		},
	},
});

describe("the Join a jump cannot bring to go on", () => {
	test("all: a jump to a branch while the other has no arrival", () => {
		expect(unreachableJoin(flow("all"), round(["one"]), "one", [])).toBe(
			"joined",
		);
		expect(unreachableJoin(flow("all"), round([]), "one", [])).toBe("joined");
	});

	test("all: a jump to the Join while a branch has no arrival", () => {
		expect(unreachableJoin(flow("all"), round(["one"]), "joined", [])).toBe(
			"joined",
		);
		expect(
			unreachableJoin(flow("all"), round(["one", "two"]), "joined", []),
		).toBe(null);
	});

	test("all: a branch whose node ended beside the stop is on its way", () => {
		expect(unreachableJoin(flow("all"), round([]), "two", ["one"])).toBe(null);
		expect(unreachableJoin(flow("all"), round([]), "joined", ["one"])).toBe(
			"joined",
		);
	});

	test("all: a jump to the branch that has no arrival goes on", () => {
		expect(unreachableJoin(flow("all"), round(["one"]), "two", [])).toBe(null);
	});

	test("first: a jump to a branch arrives itself; a jump to the Join needs an arrival", () => {
		expect(unreachableJoin(flow("first"), round([]), "two", [])).toBe(null);
		expect(unreachableJoin(flow("first"), round([]), "joined", [])).toBe(
			"joined",
		);
		expect(unreachableJoin(flow("first"), round(["one"]), "joined", [])).toBe(
			null,
		);
	});

	test("a closed round, no round, or a node before the branches: nothing", () => {
		expect(unreachableJoin(flow("all"), round(["one"], true), "one", [])).toBe(
			null,
		);
		expect(
			unreachableJoin(flow("first"), round(["one"], true), "two", []),
		).toBe(null);
		expect(unreachableJoin(flow("all"), {}, "one", [])).toBe(null);
		expect(unreachableJoin(flow("all"), round([]), "start", [])).toBe(null);
	});
});

/** A log of edges at the top level, as `outrun` reads it: each `[edge id, from, to]` in order. */
function logOf(
	edges: [string, string, string][],
	reruns: { nodeId: string; seq: number }[] = [],
) {
	return {
		edges: new Map([
			[
				scopeKey(null),
				{
					scope: null,
					taken: edges.map(([edgeId, from, to], i) => ({
						seq: i + 1,
						at: i + 1,
						stepId: null,
						payload: { edgeId, from, to, outcome: "pass", scope: null },
					})),
				},
			],
		]),
		resumes: reruns.map(({ nodeId, seq }) => ({
			seq,
			at: seq,
			stepId: null,
			payload: { nodeId, stepId: null, prompt: null, action: "rerun" as const },
		})),
	};
}

const FAN_OUT: [string, string, string][] = [
	["s1", "start", "one"],
	["s2", "start", "two"],
];

describe("the branch that lost a first Join, from the log", () => {
	test("the other branch reached the Join first: this one lost, the winner did not", () => {
		const run = logOf([...FAN_OUT, ["j1", "one", "joined"]]);
		expect(outrun(flow("first"), run, "two", null)).toBe(true);
		expect(outrun(flow("first"), run, "one", null)).toBe(false);
	});

	test("both branches reached the Join in one super-step: only the later one lost", () => {
		const run = logOf([
			...FAN_OUT,
			["j2", "two", "joined"],
			["j1", "one", "joined"],
		]);
		expect(outrun(flow("first"), run, "two", null)).toBe(false);
		expect(outrun(flow("first"), run, "one", null)).toBe(true);
	});

	test("an arrival before the latest fan-out, or before a run again from a branch, is of an earlier round", () => {
		const earlier: [string, string, string][] = [
			...FAN_OUT,
			["j1", "one", "joined"],
		];
		expect(
			outrun(flow("first"), logOf([...earlier, ...FAN_OUT]), "two", null),
		).toBe(false);
		expect(
			outrun(
				flow("first"),
				logOf(earlier, [{ nodeId: "two", seq: 10 }]),
				"two",
				null,
			),
		).toBe(false);
	});

	test("a branch of a Join that waits for all loses nothing", () => {
		const run = logOf([...FAN_OUT, ["j1", "one", "joined"]]);
		expect(outrun(flow("all"), run, "two", null)).toBe(false);
	});
});
