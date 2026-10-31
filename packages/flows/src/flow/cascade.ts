import {
	type AgentNode,
	type AgentTier,
	type CallNode,
	type CallTier,
	type DecisionNode,
	type DecisionTier,
	isPersonTier,
	type PersonTier,
	type ValueNode,
	type ValueTier,
} from "../nodes";
import type { FlowNode } from "./flow";

/**
 * A cascade's tiers as plain nodes (ADR 6). The engine runs each try of a
 * tier as the node with that tier's profile and fields, and run start
 * resolves and places each tier's profile as it does a node's. A tier is
 * a node of the same id, so the step, its visits and its edges stay the
 * node's.
 */

/** A node that can have a cascade. */
export type CascadeNode = AgentNode | DecisionNode | ValueNode | CallNode;

type AnyTier = AgentTier | DecisionTier | ValueTier | CallTier | PersonTier;

/** The node's cascade, or undefined when it has none. */
export function cascadeOf(node: FlowNode): readonly AnyTier[] | undefined {
	switch (node.type) {
		case "agent":
		case "decision":
		case "value":
		case "call":
			return node.cascade;
		default:
			return undefined;
	}
}

/** Whether the node climbs a cascade. */
export function hasCascade(node: FlowNode): node is CascadeNode {
	return cascadeOf(node) !== undefined;
}

/** The index of the person tier, or null when the cascade ends without a person. */
export function personTierIndex(node: FlowNode): number | null {
	const tiers = cascadeOf(node) ?? [];
	const index = tiers.findIndex((tier) => isPersonTier(tier));
	return index === -1 ? null : index;
}

/** The index of the last tier that is not a person, or -1 when there is none. */
export function lastModelTier(node: FlowNode): number {
	return (cascadeOf(node) ?? []).findLastIndex((tier) => !isPersonTier(tier));
}

/** Keeps the defined values only: an optional field stays absent. */
function defined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, field]) => field !== undefined),
	) as T;
}

/** Both lists, each name once; undefined when both are empty. */
function union(
	a: readonly string[] | undefined,
	b: readonly string[] | undefined,
): string[] | undefined {
	const names = [...new Set([...(a ?? []), ...(b ?? [])])];
	return names.length > 0 ? names : undefined;
}

/**
 * The node one tier of its cascade runs as: the node without its cascade,
 * with the tier's profile and fields. A field the node sets for every
 * tier (an Agent's effort, permission mode) stays; CLI tools and
 * connections add up. Null for a person tier, or an index past the end.
 */
export function tierNode<N extends FlowNode>(node: N, index: number): N | null;
export function tierNode(node: FlowNode, index: number): FlowNode | null {
	const tier = cascadeOf(node)?.[index];
	if (tier === undefined || isPersonTier(tier)) return null;
	switch (node.type) {
		case "agent": {
			const own = tier as AgentTier;
			const { cascade: _cascade, check: _check, profile: _p, ...rest } = node;
			return defined({
				...rest,
				profile: own.profile,
				harness: own.harness,
				model: own.model,
				effort: own.effort ?? node.effort,
				permissionMode: own.permissionMode ?? node.permissionMode,
				clis: union(node.clis, own.clis),
				connections: union(node.connections, own.connections),
				session: own.session ?? "fresh",
			}) satisfies AgentNode;
		}
		case "decision":
		case "value": {
			const own = tier as DecisionTier | ValueTier;
			const {
				cascade: _cascade,
				profile: _p,
				decider: _d,
				model: _m,
				address: _a,
				...rest
			} = node;
			return defined({
				...rest,
				profile: own.profile,
				decider: own.decider,
				model: own.model,
				address: own.address,
			}) as DecisionNode | ValueNode;
		}
		case "call": {
			const own = tier as CallTier;
			const { cascade: _cascade, ...rest } = node;
			const flow = own.flow ?? node.flow;
			// Another flow takes other inputs: only the tier's own bind it.
			const inputs =
				flow === node.flow
					? { ...node.inputs, ...own.inputs }
					: { ...own.inputs };
			return { ...rest, flow, inputs } satisfies CallNode;
		}
		default:
			return null;
	}
}

/**
 * The node with one tier's resolved node written back on the tier: what
 * its profile gave (an Agent's harness, model and the rest; a model's
 * decider, model and address), so the run's copy holds plain tiers.
 */
export function withTierNode<N extends FlowNode>(
	node: N,
	index: number,
	resolved: FlowNode,
): N {
	const tiers = cascadeOf(node);
	const tier = tiers?.[index];
	if (tiers === undefined || tier === undefined || isPersonTier(tier)) {
		return node;
	}
	let written: AnyTier = tier;
	if (resolved.type === "agent") {
		written = defined({
			...(tier as AgentTier),
			harness: resolved.harness,
			model: resolved.model,
			effort: resolved.effort,
			permissionMode: resolved.permissionMode,
			clis: resolved.clis,
			connections: resolved.connections,
		});
	} else if (resolved.type === "decision" || resolved.type === "value") {
		const { address: _old, ...own } = tier as DecisionTier | ValueTier;
		written = defined({
			...own,
			decider: resolved.decider,
			model: resolved.model,
			address: resolved.address,
		});
	}
	const cascade = tiers.map((each, at) => (at === index ? written : each));
	return { ...node, cascade } as N;
}
