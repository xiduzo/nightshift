import {
	type CascadeNode,
	cascadeOf,
	isPersonTier,
	NODE_TYPE_LABEL,
	type PersonTier,
	tierNode,
} from "@nightshift/flows";
import { type Climb, climbAt } from "./cascade";
import type { NodeAction, StepContext } from "./context";
import { type GateAsk, gateChooser } from "./nodes/choosers/person";

/**
 * The climb of a node with a cascade (ADR 6), beside the step runner: one
 * dispatch for the four node types that have one. It reads where the node
 * stands on its cascade, and runs that tier: the person tier's Gate, or
 * one try of a tier that is not a person. A node gives only what differs:
 * what its person tier asks, and how it runs one try.
 *
 * The climb rides on the step: a try hands it to the step runner
 * (`StepSpec.climb`, or `beginStep`'s start for a Call), the person tier's
 * Gate takes it (`GateAsk.climb`). So the step's templates read
 * `{{cascade.*}}`, every end of the step adds `tier` and `tries`, and an
 * end that does not hold climbs to the next try. What holds stays the
 * node's: an Agent's check, a Decision's `minConfidence`, a Value's
 * `accept` rule, a Call's flow that ends `pass`.
 */

/** A tier of a node's cascade that is not a person. */
export type TierOf<N extends CascadeNode> = Exclude<
	NonNullable<N["cascade"]>[number],
	PersonTier
>;

/** What a node with a cascade gives its climb. */
export type ClimbParts<N extends CascadeNode> = {
	/** What the person tier's Gate asks: its question, choices, deadline and brief. */
	person(climb: Climb<PersonTier>): GateAsk;
	/**
	 * One try of a tier that is not a person. `node` is the tier's node
	 * (`tierNode`): the node without its cascade, with the tier's fields.
	 */
	attempt(node: N, climb: Climb<TierOf<N>>): NodeAction;
};

/**
 * The graph node of `root`, which has a cascade: each visit runs the tier
 * at its position. A position past the last tier throws: the climb ends
 * before it gets there.
 */
export function climbing<N extends CascadeNode>(
	root: N,
	ctx: StepContext,
	parts: ClimbParts<N>,
): NodeAction {
	return (state, config) => {
		const at = climbAt(state, root);
		const tier = cascadeOf(root)?.[at.tier];
		const own = tierNode(root, at.tier);
		if (tier !== undefined && isPersonTier(tier)) {
			const climb = { root, at, tier };
			return gateChooser(root, ctx, { ...parts.person(climb), climb })(
				state,
				config,
			);
		}
		if (tier === undefined || own === null) {
			throw new Error(
				`${NODE_TYPE_LABEL[root.type]} node "${root.id}" has no tier ${at.tier + 1} in its cascade.`,
			);
		}
		return parts.attempt(own, { root, at, tier: tier as TierOf<N> })(
			state,
			config,
		);
	};
}
