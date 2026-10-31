import { Command } from "@langchain/langgraph";
import {
	type CascadeNode,
	cascadeOf,
	type FlowNode,
	isPersonTier,
	type JsonValue,
	lastModelTier,
	type PersonTier,
	tierLabel,
	tierNode,
} from "@nightshift/flows";
import type { GateChoice, StepOutcome, StepOutputs } from "../log";
import type { StepEnd } from "./route";
import { commitVisit } from "./run-position";
import type {
	CascadePosition,
	CascadeTry,
	RunStateUpdate,
	RunStateValues,
} from "./state";
import type { StepSpec } from "./step-runner";

/**
 * The climb of a cascade (ADR 6), walked inside the node. Each try is a
 * step of its own: a visit with its tier, so budgets and the step cap
 * count every try. A try runs as the node of its tier (`tierNode`): that
 * tier's profile, on that profile's Device.
 *
 * A try that does not hold ends its step `fail` (or `error`), and the node
 * goes back to itself with the next position (`climbCommand`), not along an
 * edge: the graph and its loop rules stay as they are. The position lives
 * in the state (`cascades`), so it commits with the checkpoint of the try
 * before: a park, a resume or a daemon death continues at the tier and try
 * where it stopped. `route()` clears it when the node goes on.
 *
 * What holds is the node's: a Decision's pick with enough probability, a
 * Value that matches and passes its `accept` rule, an Agent that ends
 * `pass` and whose check exits 0, a Call whose flow ends `pass`. Every
 * node ends a try that does not hold with `fail`, or `error` when it could
 * not try, so the climb reads only the outcome.
 */

/** Where a node starts its cascade: the first tier, the first try. */
const START: CascadePosition = { tier: 0, try: 1, trail: [] };

/** The node's position on its cascade, from the state. */
export function climbAt(
	state: Pick<RunStateValues, "cascades">,
	node: Pick<FlowNode, "id">,
): CascadePosition {
	return state.cascades?.[node.id] ?? START;
}

/** An outcome that does not hold: the node tries again, or ends there. */
export function notHolding(outcome: StepOutcome): boolean {
	return outcome === "fail" || outcome === "error";
}

/**
 * One try of a cascade as its node runs it: the node with the cascade
 * (`root`), the position, and the tier's own fields (`minConfidence`,
 * `accept`, `session`, `check` is the root's).
 */
export type Climb<T> = { root: CascadeNode; at: CascadePosition; tier: T };

/** A tier that is not a person, as `cascade` holds it. */
type ModelTier = Exclude<
	NonNullable<ReturnType<typeof cascadeOf>>[number],
	PersonTier
>;

/** The tier at a position: a person tier, a tier as a node with its fields, or null past the end. */
export function tierAt(
	node: CascadeNode,
	at: CascadePosition,
):
	| { kind: "person"; tier: PersonTier }
	| { kind: "node"; node: FlowNode; tier: ModelTier }
	| null {
	const tier = cascadeOf(node)?.[at.tier];
	if (tier === undefined) return null;
	if (isPersonTier(tier)) return { kind: "person", tier };
	const own = tierNode(node, at.tier);
	return own === null ? null : { kind: "node", node: own, tier };
}

/** The name of the tier at a position. */
export function tierLabelAt(node: CascadeNode, at: CascadePosition): string {
	const tier = cascadeOf(node)?.[at.tier];
	return tier === undefined ? "" : tierLabel(tier, at.tier);
}

/** What `{{cascade.tier}}`, `{{cascade.try}}` and `{{cascade.previous}}` read. */
export function climbValues(
	node: CascadeNode,
	at: CascadePosition,
): Record<string, JsonValue> {
	const previous = at.trail.at(-1);
	return {
		tier: tierLabelAt(node, at),
		try: at.try,
		previous: previous === undefined ? "" : (previous as JsonValue),
	};
}

/** The fields a try adds to its step's outputs: its tier and the tries so far. */
export function climbOutputs(
	node: CascadeNode,
	at: CascadePosition,
): StepOutputs {
	return { tier: tierLabelAt(node, at), tries: at.trail.length + 1 };
}

/** How often a tier is tried: its `tries`, else once. A person tier once. */
function triesOf(node: CascadeNode, index: number): number {
	const tier = cascadeOf(node)?.[index];
	if (tier === undefined || isPersonTier(tier)) return 1;
	return tier.tries ?? 1;
}

/**
 * The position after a try that did not hold: the next try of the tier,
 * else the first of the next tier, else null (no tier left: the step ends
 * on the try's outcome). `done` is the try that did not hold.
 */
export function nextTry(
	node: CascadeNode,
	at: CascadePosition,
	done: CascadeTry,
): CascadePosition | null {
	const tiers = cascadeOf(node) ?? [];
	const trail = [...at.trail, done];
	if (at.try < triesOf(node, at.tier)) {
		return { tier: at.tier, try: at.try + 1, trail };
	}
	if (at.tier + 1 < tiers.length) {
		return { tier: at.tier + 1, try: 1, trail };
	}
	return null;
}

/**
 * The position after a person chose "try-again": one more try on the last
 * tier that is not a person, with the person's note.
 */
export function tryAgain(
	node: CascadeNode,
	at: CascadePosition,
	note: string,
): CascadePosition {
	const last = lastModelTier(node);
	const tries = at.trail.filter(
		(done) => done.tier === tierLabelAt(node, { ...at, tier: last }),
	).length;
	return {
		tier: last,
		try: tries + 1,
		trail: at.trail,
		...(note === "" ? {} : { note }),
	};
}

/** At most this many characters of a try's text in the trail: the state stays small. */
const TRAIL_TEXT = 4000;

const clip = (text: string) =>
	text.length > TRAIL_TEXT ? `…${text.slice(-TRAIL_TEXT)}` : text;

/** What a try that ended gives the next one: its outcome and what it said, from its outputs. */
export function tryRecord(
	node: CascadeNode,
	at: CascadePosition,
	end: Pick<StepEnd, "outcome" | "outputs" | "error">,
): CascadeTry {
	const { outputs } = end;
	const text = (field: string) =>
		typeof outputs[field] === "string" ? (outputs[field] as string) : "";
	const said =
		text("summary") || text("note") || text("end_message") || text("ended");
	const summary = [said, end.error ?? ""]
		.filter((part) => part !== "")
		.join(" ");
	const record: CascadeTry = {
		tier: tierLabelAt(node, at),
		try: at.try,
		outcome: end.outcome,
		summary: clip(summary),
	};
	if (text("pick") !== "") record.pick = text("pick");
	if (typeof outputs.confidence === "number") {
		record.confidence = outputs.confidence;
	}
	if (text("log_tail") !== "") record.log_tail = clip(text("log_tail"));
	if (text("session_id") !== "") record.session_id = text("session_id");
	return record;
}

/**
 * The node goes back to itself for the next try: the try's outputs in the
 * state, its visit committed, nothing held, the next position. No edge is
 * taken.
 */
export function climbCommand(
	node: Pick<FlowNode, "id">,
	end: StepEnd,
	next: CascadePosition,
	extra?: RunStateUpdate,
): Command {
	return new Command({
		update: {
			...extra,
			nodes: { [node.id]: end.outputs },
			...commitVisit(node, end.visit),
			pending: { [node.id]: null },
			cascades: { [node.id]: next },
		},
		goto: node.id,
	});
}

/**
 * The climb of a node whose try runs through the step runner (`runStep`):
 * an end that does not hold climbs while a try is left.
 */
export function climbSpec(
	node: CascadeNode,
	at: CascadePosition,
): NonNullable<StepSpec["climb"]> {
	const next = (end: Pick<StepEnd, "outcome" | "outputs" | "error">) =>
		nextTry(node, at, tryRecord(node, at, end));
	return {
		climbs: (end) => notHolding(end.outcome) && next(end) !== null,
		command: (end) => climbCommand(node, end, next(end) ?? at),
	};
}

/** The choices of the person tier of an Agent or a Call. */
export const RETRY_GATE_CHOICES: readonly GateChoice[] = [
	{
		name: "try-again",
		description: "Try once more on the last tier, with your note.",
		color: "green",
	},
	{
		name: "stop",
		description: "End this step as failed.",
		color: "red",
	},
];

/**
 * What the person tier shows of the climb: one line per try, with the
 * tier, its pick and probability, or what went wrong.
 */
export function climbLines(trail: readonly CascadeTry[]): string {
	return trail
		.map((done) => {
			const where = done.try > 1 ? `${done.tier} (try ${done.try})` : done.tier;
			if (done.pick !== undefined) {
				const sure =
					done.confidence === undefined
						? ""
						: ` with ${Math.round(done.confidence * 100)}%`;
				return `- ${where} picked ${done.pick}${sure}.`;
			}
			const said = done.summary.split("\n")[0]?.trim() ?? "";
			return `- ${where} ended ${done.outcome}${said === "" ? "." : `: ${said}`}`;
		})
		.join("\n");
}
