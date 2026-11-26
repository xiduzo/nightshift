import { describe, expect, test } from "bun:test";
import type { JoinNode } from "@nightshift/flows";
import { command, edge, flowOf } from "../../testing/graph";
import type { JoinRound } from "../state";
import { unreachableJoin } from "./branches";

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
