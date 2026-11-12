import type { FlowNodeType } from "@nightshift/flows";
import {
	addCost,
	type CostTally,
	type DerivedStep,
	NO_COST,
	type RungBy,
	type Scope,
	type StepOutcome,
	type StepRung,
	scopeKey,
} from "../log";
import { calledCosts } from "./run-views";

/**
 * Where the work landed (Q31): each climb of a node up its ladder, and the
 * rung it landed on. Pure over the steps of the run state, like the run
 * metrics. Nothing here is stored.
 *
 * Two ladders. The work ladder holds Agent, Subflow (Call) and Value
 * steps: a Value by model, and an Ask. A Value by rule is on no ladder.
 * The choice ladder holds Decision steps.
 *
 * A climb is the steps of one node in one scope, oldest first, up to its
 * landing. Each try of a cascade is a step of its own (ADR 6). A node
 * without a cascade lands on every visit. A step that ended `stopped` or
 * `interrupted` stays in the climb: the node goes on with it later. A
 * climb the run never finished does not land.
 *
 * A step lands when it holds, when no try follows it (`StepRung.last`),
 * or when it is a person's (a Gate, an Ask, a person tier) whose answer is
 * not `try-again`. A try holds when it does not end `fail` or `error`: a
 * node ends a try that does not hold that way.
 *
 * Steps of older Walkers name no rung. They are read from their outputs:
 * a try of a cascade has a `tier` label (the first label of a climb is the
 * first tier, any other a later one), a step with a Gate and no session is
 * a person's, and a Decision without a cascade was chosen by a decider when
 * its end cost a call, else by a rule. A Value without a cascade that cost
 * nothing was made by a rule.
 */

/** The two ladders: the work ladder, and the choice ladder (Decisions). */
export type Ladder = "work" | "choice";

/**
 * Where a climb landed, one closed list:
 *
 * - `rule`: a Decision by rule chose.
 * - `first`: the first tier held, or a node without a cascade did.
 * - `later`: a later tier held.
 * - `person`: the climb reached a person, who answered.
 * - `deadline`: the climb reached a person, and the deadline answered.
 * - `none`: no try held, and no person was asked.
 */
export const RUNGS = [
	"rule",
	"first",
	"later",
	"person",
	"deadline",
	"none",
] as const;
export type Rung = (typeof RUNGS)[number];

/** The rung one try stands on. Only a landing is `deadline` or `none`. */
export type TryRung = Extract<Rung, "rule" | "first" | "later" | "person">;

/** One climb that landed. */
export type Landing = {
	ladder: Ladder;
	nodeId: string;
	nodeType: FlowNodeType;
	/** The Call nodes it ran in, outermost first, joined by `/`. Null at the top level. */
	via: string | null;
	scope: Scope | null;
	/** The step it landed on: the climb's last. */
	stepId: string;
	/** When it landed: that step's end. */
	at: number;
	rung: Rung;
	/** Who made it land: a `person` on `person` and `deadline`, else who tried the last step. */
	by: RungBy;
	/** The name of the tier it landed on. Null for a node without a cascade. */
	tier: string | null;
	/** The steps of the climb, a stopped one included. */
	tries: number;
	/** What every try cost. A Subflow's try costs what its called flow cost too. */
	cost: CostTally;
	/** A Decision: a decider gave a probability on a try. */
	picked: boolean;
	/** A Decision: a decider's pick fell below its tier's `minConfidence`. */
	unsure: boolean;
};

/** The ladder of a run: the rung each step's try stands on, and every landing. */
export type RunLadder = {
	/** By step id. Only steps on a ladder. */
	tries: ReadonlyMap<string, TryRung>;
	/** In the order they landed. */
	landings: Landing[];
};

/** The ladder each node type climbs. Any other type is on no ladder. */
const LADDER_OF: Partial<Record<FlowNodeType, Ladder>> = {
	agent: "work",
	call: "work",
	value: "work",
	decision: "choice",
};

/** Who tries a cascade's tier that is not a person, by node type (older steps). */
const TIER_BY: Partial<Record<FlowNodeType, RungBy>> = {
	agent: "agent",
	call: "flow",
	value: "model",
	decision: "model",
};

/** One step of an open climb, with the rung it stands on. */
type ClimbStep = { step: DerivedStep; rung: StepRung };

/** An open climb: its steps so far, and the first tier label it saw (older steps). */
type Climb = { steps: ClimbStep[]; firstLabel: string | null };

/** The ladder of a run, from its steps. */
export function ladderOf(steps: readonly DerivedStep[]): RunLadder {
	const ordered = [...steps].sort((a, b) => firstSeq(a) - firstSeq(b));
	const byId = new Map(steps.map((step) => [step.id, step]));
	const inside = calledCosts(steps, (scope) => scope.parentStepId);
	const later = laterSteps(ordered);
	const open = new Map<string, Climb>();
	const tries = new Map<string, TryRung>();
	const landings: Landing[] = [];
	for (const step of ordered) {
		const ladder = LADDER_OF[step.nodeType];
		if (ladder === undefined) continue;
		const key = climbKey(step);
		const climb = open.get(key) ?? { steps: [], firstLabel: null };
		const rung = step.rung ?? olderRung(step, climb, later.get(step.id));
		if (rung === null) continue;
		const label = tierOf(step);
		if (rung.by !== "person" && label !== null) climb.firstLabel ??= label;
		climb.steps.push({ step, rung });
		tries.set(step.id, tryRung(rung));
		if (!lands(step.outcome, rung)) {
			open.set(key, climb);
			continue;
		}
		open.delete(key);
		landings.push(landing(ladder, climb.steps, byId, inside));
	}
	landings.sort((a, b) => a.at - b.at);
	return { tries, landings };
}

/** The landings of a run's steps (`ladderOf`). */
export function landingsOf(steps: readonly DerivedStep[]): Landing[] {
	return ladderOf(steps).landings;
}

/** A step's first opening: the order the steps started in. */
function firstSeq(step: DerivedStep): number {
	return step.openings[0]?.seq ?? step.startSeq;
}

/** The node and the scope a climb belongs to. */
function climbKey(step: DerivedStep): string {
	return `${scopeKey(step.scope)}\n${step.nodeId}`;
}

/** The next step of the same node and scope, by step id (older steps look ahead). */
function laterSteps(ordered: readonly DerivedStep[]) {
	const next = new Map<string, DerivedStep>();
	const last = new Map<string, DerivedStep>();
	for (const step of ordered) {
		const key = climbKey(step);
		const before = last.get(key);
		if (before) next.set(before.id, step);
		last.set(key, step);
	}
	return next;
}

/** The tier label a try's outputs carry (`climbOutputs`), or null. */
function tierOf(step: DerivedStep): string | null {
	const { tier } = step.outputs;
	return typeof tier === "string" ? tier : null;
}

/** A try that ended and holds: not `fail`, `error`, `try-again` or cut short. */
function holds(outcome: StepOutcome | null): boolean {
	return (
		outcome !== null &&
		outcome !== "fail" &&
		outcome !== "error" &&
		outcome !== "try-again" &&
		outcome !== "stopped" &&
		outcome !== "interrupted"
	);
}

/** Whether the climb lands on this step. */
function lands(outcome: StepOutcome | null, rung: StepRung): boolean {
	if (outcome === null || outcome === "stopped" || outcome === "interrupted") {
		return false;
	}
	if (rung.by === "person") return outcome !== "try-again";
	return holds(outcome) || rung.last === true;
}

/** The rung a try stands on. */
function tryRung(rung: StepRung): TryRung {
	if (rung.by === "rule" || rung.by === "person") return rung.by;
	return (rung.tier ?? 0) === 0 ? "first" : "later";
}

/**
 * The rung of a step whose `StepStarted` names none: a step of an older
 * Walker, or a step on no ladder (null). `next` is the next step of the
 * same node and scope: a try that does not hold is the last of its climb
 * when no try of the climb follows.
 */
function olderRung(
	step: DerivedStep,
	climb: Climb,
	next: DerivedStep | undefined,
): StepRung | null {
	const asked = step.gateWaits.length > 0 && step.sessions.length === 0;
	const label = tierOf(step);
	if (label !== null) {
		if (asked) return { by: "person" };
		const by = TIER_BY[step.nodeType];
		if (by === undefined) return null;
		// A try of the same climb follows: it counts its tries on.
		const goesOn =
			next !== undefined &&
			(next.outcome === null ||
				(typeof next.outputs.tries === "number" && next.outputs.tries > 1));
		return {
			by,
			tier: label === (climb.firstLabel ?? label) ? 0 : 1,
			...(goesOn ? {} : { last: true as const }),
		};
	}
	if (asked && (step.nodeType === "decision" || step.nodeType === "value")) {
		return { by: "person", last: true };
	}
	switch (step.nodeType) {
		case "agent":
			return { by: "agent", last: true };
		case "call":
			return { by: "flow", last: true };
		case "decision":
			return { by: step.cost.calls > 0 ? "model" : "rule", last: true };
		case "value":
			return step.cost.calls > 0 ? { by: "model", last: true } : null;
		default:
			return null;
	}
}

/** The landing of a climb whose last step landed. */
function landing(
	ladder: Ladder,
	steps: readonly ClimbStep[],
	byId: ReadonlyMap<string, DerivedStep>,
	inside: ReadonlyMap<string, CostTally>,
): Landing {
	const last = steps[steps.length - 1] as ClimbStep;
	const person = steps.findLast(({ rung }) => rung.by === "person");
	const { step } = last;
	let cost = NO_COST;
	for (const each of steps) {
		cost = addCost(cost, each.step.cost);
		cost = addCost(cost, inside.get(each.step.id) ?? NO_COST);
	}
	return {
		ladder,
		nodeId: step.nodeId,
		nodeType: step.nodeType,
		via: viaOf(step, byId),
		scope: step.scope,
		stepId: step.id,
		at: step.endedAt ?? step.startedAt,
		rung: person
			? person.step.gateWaits.at(-1)?.answeredBy === "deadline"
				? "deadline"
				: "person"
			: !holds(step.outcome)
				? "none"
				: tryRung(last.rung),
		by: person ? "person" : last.rung.by,
		tier: tierOf(person?.step ?? step),
		tries: steps.length,
		cost,
		picked: steps.some(
			(each) => typeof each.step.outputs.confidence === "number",
		),
		unsure: steps.some((each) => typeof each.step.outputs.pick === "string"),
	};
}

/** The ids of the Call nodes a step ran in, outermost first, joined by `/`; null at the top level. */
function viaOf(
	step: DerivedStep,
	byId: ReadonlyMap<string, DerivedStep>,
): string | null {
	const calls: string[] = [];
	const seen = new Set<string>();
	for (
		let caller = step.scope ? byId.get(step.scope.parentStepId) : undefined;
		caller && !seen.has(caller.id);
		caller = caller.scope ? byId.get(caller.scope.parentStepId) : undefined
	) {
		seen.add(caller.id);
		calls.unshift(caller.nodeId);
	}
	return calls.length === 0 ? null : calls.join("/");
}

/**
 * The landings of a run per node, rung and tier (`RunMetrics.ladder`):
 * how often each landed, and what those landings cost, every try
 * included. A Decision's entry counts how often a decider gave a
 * probability (`picked`) and fell below its minimum (`unsure`).
 */
export type RunRung = {
	ladder: Ladder;
	nodeId: string;
	/** The Call nodes it ran in, outermost first, joined by `/`. Absent at the top level. */
	via?: string;
	rung: Rung;
	by: RungBy;
	/** The name of the tier. Null for a node without a cascade. */
	tier: string | null;
	landed: number;
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
	/** A Decision's entry only. */
	picked?: number;
	/** A Decision's entry only. */
	unsure?: number;
};

/** The landings added up per node, rung and tier, in the order each first landed. */
export function runRungs(landings: readonly Landing[]): RunRung[] {
	const rows = new Map<string, RunRung>();
	for (const each of landings) {
		const key = [
			each.ladder,
			each.via ?? "",
			each.nodeId,
			each.rung,
			each.by,
			each.tier ?? "",
		].join("\n");
		const row = rows.get(key) ?? {
			ladder: each.ladder,
			nodeId: each.nodeId,
			...(each.via !== null ? { via: each.via } : {}),
			rung: each.rung,
			by: each.by,
			tier: each.tier,
			landed: 0,
			costUsd: 0,
			costEstimated: false,
			costMissing: 0,
			...(each.ladder === "choice" ? { picked: 0, unsure: 0 } : {}),
		};
		row.landed += 1;
		row.costUsd += each.cost.usd;
		row.costEstimated ||= each.cost.estimated;
		row.costMissing += each.cost.missing;
		if (row.picked !== undefined && each.picked) row.picked += 1;
		if (row.unsure !== undefined && each.unsure) row.unsure += 1;
		rows.set(key, row);
	}
	return [...rows.values()];
}
