import type { CascadeNode, FlowNodeType } from "@nightshift/flows";
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
 * Only the rungs that did the work count. A Subflow without a cascade is
 * on no ladder: the steps of the flow it calls did its work, and they land
 * on their own (`via` names the Subflow). Counted next to them, it would
 * land a second time for the same work. A Subflow with a cascade stays:
 * the tier that held is where its work landed, and its landing costs what
 * its tiers' flows cost. So the work steps inside a try of it (at any
 * depth) are on no ladder: they are that tier's work, and they would land
 * a second time. Only that climb shows how far the work climbed: inside a
 * tier's flow, each Agent lands on its own first rung. A Decision inside
 * stays on the choice ladder: a choice is not the tier's work.
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
	/**
	 * The steps that asked a person after another try of the same climb: a
	 * ladder ran out. A person who is the only try of a climb was drawn
	 * there, and is not in it.
	 */
	fallbacks: ReadonlySet<string>;
};

/**
 * The node types that can have a cascade (ADR 6), one entry each: the
 * ladder each climbs, and who tries a tier that is not a person. Only
 * these types are on a ladder. A new type with a cascade does not
 * compile without its entry. The climb (`graph/cascade.ts`) reads `by`
 * for a new step's rung; this module reads it for a step of an older
 * Walker, which names no rung.
 */
export const CASCADE_RUNGS = {
	agent: { ladder: "work", by: "agent" },
	call: { ladder: "work", by: "flow" },
	decision: { ladder: "choice", by: "model" },
	value: { ladder: "work", by: "model" },
} as const satisfies Record<
	CascadeNode["type"],
	{ ladder: Ladder; by: RungBy }
>;

/** Whether a node type is on a ladder: one that can have a cascade. */
function onLadder(type: FlowNodeType): type is CascadeNode["type"] {
	return Object.hasOwn(CASCADE_RUNGS, type);
}

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
	const fallbacks = new Set<string>();
	const landings: Landing[] = [];
	for (const step of ordered) {
		if (!onLadder(step.nodeType)) continue;
		const { ladder } = CASCADE_RUNGS[step.nodeType];
		if (ladder === "work" && inCascadeTry(step, byId)) continue;
		const key = climbKey(step);
		const climb = open.get(key) ?? { steps: [], firstLabel: null };
		const rung = step.rung ?? olderRung(step, climb, later.get(step.id));
		if (rung === null || plainSubflow(step, rung)) continue;
		const label = tierOf(step);
		if (rung.by !== "person" && label !== null) climb.firstLabel ??= label;
		if (
			rung.by === "person" &&
			climb.steps.some((before) => before.rung.by !== "person")
		) {
			fallbacks.add(step.id);
		}
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
	return { tries, landings, fallbacks };
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

/**
 * A Subflow without a cascade: its rung names no tier. Its called flow's
 * steps did the work, so it is on no ladder.
 */
function plainSubflow(step: DerivedStep, rung: StepRung): boolean {
	return (
		step.nodeType === "call" && rung.by === "flow" && rung.tier === undefined
	);
}

/**
 * Whether the step ran inside a try of a Subflow with a cascade, at any
 * depth: its work is that tier's work, which lands on the Subflow.
 */
function inCascadeTry(
	step: DerivedStep,
	byId: ReadonlyMap<string, DerivedStep>,
): boolean {
	const seen = new Set<string>();
	for (
		let caller = step.scope ? byId.get(step.scope.parentStepId) : undefined;
		caller && !seen.has(caller.id);
		caller = caller.scope ? byId.get(caller.scope.parentStepId) : undefined
	) {
		seen.add(caller.id);
		if (caller.nodeType === "call" && cascadeTry(caller)) return true;
	}
	return false;
}

/**
 * A try of a Subflow's cascade: its rung names a tier. A step of an older
 * Walker names no rung: its tier label says so (`olderRung`).
 */
function cascadeTry(step: DerivedStep): boolean {
	return step.rung
		? step.rung.by === "flow" && step.rung.tier !== undefined
		: tierOf(step) !== null;
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
		if (!onLadder(step.nodeType)) return null;
		const { by } = CASCADE_RUNGS[step.nodeType];
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
