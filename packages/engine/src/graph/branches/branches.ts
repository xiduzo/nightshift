import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import {
	type BranchPlace,
	branchPlaces,
	type FanOut,
	type Flow,
	type FlowNode,
} from "@nightshift/flows";
import { scopeKey } from "../../log";
import type { RunStateUpdate, RunStateValues } from "../state";

/**
 * Parallel branches as the walk runs them. A fan-out (several edges
 * without a max on one outcome, `@nightshift/flows` `fanOutsOf`) sends the
 * walk to every branch in one super-step: LangGraph runs their nodes as
 * tasks side by side, and each branch moves on in the super-steps after.
 * The branches meet at a Join node, which goes on once its rule holds.
 *
 * The state keeps one round per Join (`joins`, `JoinRound`): the fan-out
 * opens it, each branch that reaches the Join arrives in it, and the Join
 * closes it when it goes on. A step of a branch whose round is closed goes
 * no further: it is a branch a `first` Join left behind.
 *
 * A `first` Join is a race. The branch that reaches it first claims the
 * round in this process (`Races`), and the steps that still run in the
 * other branches are aborted at once: without that, the Join would wait
 * for them, since a super-step ends only when all its tasks did. The
 * claim lives in memory only. After a restart the Join itself decides
 * from the state: the earliest arrival wins.
 */

const placesOf = new WeakMap<Flow, Map<string, BranchPlace>>();

/** Every node on a branch, with its fan-out and branch: one analysis per flow, so the objects compare. */
function places(flow: Flow): Map<string, BranchPlace> {
	let known = placesOf.get(flow);
	if (!known) {
		known = branchPlaces(flow);
		placesOf.set(flow, known);
	}
	return known;
}

/** The branch `nodeId` is on, in this flow, or null when it is on none. */
export function placeOf(flow: Flow, nodeId: string): BranchPlace | null {
	return places(flow).get(nodeId) ?? null;
}

/** The fan-out whose branches meet at Join `joinId`, in this flow. */
export function fanOutOf(flow: Flow, joinId: string): FanOut | null {
	for (const place of places(flow).values()) {
		if (place.fanOut.join === joinId) return place.fanOut;
	}
	return null;
}

/** The race of the `first` Joins, and the running steps of branches it may abort. In memory, one per Thread. */
export type Races = {
	/** A step of a branch node runs: `abort` stops it when its branch loses. Returns the release. */
	running(scope: string, nodeId: string, abort: () => void): () => void;
	/** Claims a round of a Join for one branch (its edge id). True for the first claim only. */
	claim(scope: string, joinId: string, round: number, branch: string): boolean;
	/** The branch that claimed the round, or null. */
	winner(scope: string, joinId: string, round: number): string | null;
	/** Stops the running step of `nodeId`, when one runs. */
	abort(scope: string, nodeId: string): void;
};

export function createRaces(): Races {
	const claims = new Map<string, string>();
	const steps = new Map<string, () => void>();
	const at = (...parts: (string | number)[]) => parts.join("\u0000");
	return {
		running(scope, nodeId, abort) {
			const key = at(scope, nodeId);
			steps.set(key, abort);
			return () => {
				if (steps.get(key) === abort) steps.delete(key);
			};
		},
		claim(scope, joinId, round, branch) {
			const key = at(scope, joinId, round);
			if (claims.has(key)) return false;
			claims.set(key, branch);
			return true;
		},
		winner: (scope, joinId, round) =>
			claims.get(at(scope, joinId, round)) ?? null,
		abort(scope, nodeId) {
			steps.get(at(scope, nodeId))?.();
		},
	};
}

/** What the branch helpers read of a graph: its flow and the race. */
type BranchContext = { flow: Flow; races: Races };

const scopeOfConfig = (config: LangGraphRunnableConfig) =>
	scopeKey(
		(config.configurable?.scope as Parameters<typeof scopeKey>[0]) ?? null,
	);

/**
 * Whether `node` is on a branch that goes no further: its Join's round is
 * closed (the Join went on without it), or another branch claimed a
 * `first` Join's round in this process.
 */
export function outrun(
	ctx: BranchContext,
	state: Pick<RunStateValues, "joins">,
	node: Pick<FlowNode, "id">,
	config: LangGraphRunnableConfig,
): boolean {
	const place = placeOf(ctx.flow, node.id);
	const joinId = place?.fanOut.join;
	if (!place || !joinId) return false;
	const round = state.joins?.[joinId];
	if (!round) return false;
	if (round.closed) return true;
	const winner = ctx.races.winner(scopeOfConfig(config), joinId, round.round);
	return winner !== null && winner !== place.branch.edge.id;
}

/** The state a fan-out writes with its edges: a new round of its Join. */
export function openRound(
	ctx: Pick<BranchContext, "flow">,
	state: Pick<RunStateValues, "joins">,
	from: string,
	outcome: string,
): RunStateUpdate {
	let joinId: string | null = null;
	for (const place of places(ctx.flow).values()) {
		const { fanOut } = place;
		if (fanOut.from === from && fanOut.outcome === outcome) {
			joinId = fanOut.join;
			break;
		}
	}
	if (!joinId) return {};
	const round = (state.joins?.[joinId]?.round ?? 0) + 1;
	return { joins: { [joinId]: { round, arrived: [], closed: false } } };
}

/**
 * The state a jump to `nodeId` writes so that its Join goes on again: the
 * next round of that Join, open. A re-entry jumps to a node whose round is
 * closed: the Join itself (a resume of a run whose last step was the
 * Join), or a node of a branch (a run again from it). Without a new round
 * the Join sees a round it closed and does nothing, and the walk stops
 * without an end. The jump to the Join keeps every arrival. The jump to a
 * branch keeps the arrivals of the other branches, and that branch arrives
 * again; a `first` Join keeps none, so it waits for the next arrival.
 * Nothing when `nodeId` is neither, or its Join's round is still open.
 */
export function reopenRound(
	flow: Flow,
	state: Partial<Pick<RunStateValues, "joins">>,
	nodeId: string,
): RunStateUpdate {
	const place = placeOf(flow, nodeId);
	const atJoin = !place;
	const joinId = place?.fanOut.join ?? nodeId;
	const join = flow.nodes.find((n) => n.id === joinId);
	const round = state.joins?.[joinId];
	if (join?.type !== "join" || !round?.closed) return {};
	const arrived = atJoin
		? round.arrived
		: join.wait === "first"
			? []
			: round.arrived.filter(
					(a) => placeOf(flow, a.from)?.branch !== place.branch,
				);
	return {
		joins: { [joinId]: { round: round.round + 1, arrived, closed: false } },
	};
}

/**
 * The Join that a jump to `nodeId` cannot bring to go on, or null. That is
 * the Join of `nodeId`'s branch, or `nodeId` itself, while its round is
 * open and its rule cannot hold: a branch it waits for has no arrival, the
 * jump does not run that branch, and none of `onTheirWay` (the nodes whose
 * writes the walk still goes on from) is on it. A run again leaves the
 * other branches as they are, so the Join would wait for ever. A closed
 * round is `reopenRound`'s case, and a jump to a branch of a `first` Join
 * arrives itself.
 */
export function unreachableJoin(
	flow: Flow,
	state: Partial<Pick<RunStateValues, "joins">>,
	nodeId: string,
	onTheirWay: readonly string[],
): string | null {
	const place = placeOf(flow, nodeId);
	const joinId = place?.fanOut.join ?? nodeId;
	const join = flow.nodes.find((n) => n.id === joinId);
	const round = state.joins?.[joinId];
	const fanOut = place?.fanOut ?? fanOutOf(flow, joinId);
	if (join?.type !== "join" || !round || round.closed || !fanOut) return null;
	const reached = new Set(place ? [place.branch] : []);
	for (const from of [...round.arrived.map((a) => a.from), ...onTheirWay]) {
		const at = placeOf(flow, from);
		if (at?.fanOut === fanOut) reached.add(at.branch);
	}
	const holds =
		join.wait === "first"
			? reached.size > 0
			: fanOut.branches.every((branch) => reached.has(branch));
	return holds ? null : joinId;
}

/**
 * The state a branch writes when it reaches its Join: its arrival in the
 * Join's round. For a `first` Join the first arrival also claims the round
 * and stops the steps that run in the other branches.
 */
export function arrive(
	ctx: BranchContext,
	state: Pick<RunStateValues, "joins">,
	from: string,
	join: FlowNode,
	at: number,
	config: LangGraphRunnableConfig,
): RunStateUpdate {
	const place = placeOf(ctx.flow, from);
	const round = state.joins?.[join.id];
	if (!place || place.fanOut.join !== join.id || !round) return {};
	if (join.type === "join" && join.wait === "first") {
		const scope = scopeOfConfig(config);
		if (ctx.races.claim(scope, join.id, round.round, place.branch.edge.id)) {
			for (const branch of place.fanOut.branches) {
				if (branch === place.branch) continue;
				for (const id of branch.nodes) ctx.races.abort(scope, id);
			}
		}
	}
	return {
		joins: {
			[join.id]: {
				round: round.round,
				arrived: [{ from, at }],
				closed: false,
			},
		},
	};
}
