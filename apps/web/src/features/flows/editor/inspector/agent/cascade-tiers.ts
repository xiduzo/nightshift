import {
	type AgentTier,
	type CallTier,
	type CascadeNode,
	type DecisionTier,
	isPersonTier,
	type PersonTier,
	type ValueTier,
} from "@nightshift/flows";

export type ModelTier = AgentTier | DecisionTier | ValueTier | CallTier;
export type Tier = ModelTier | PersonTier;

/** The node's first tier from what it runs on now: its profile, or its own model. */
function firstTier(node: CascadeNode): ModelTier {
	switch (node.type) {
		case "agent":
			return node.profile !== undefined
				? { profile: node.profile }
				: {
						...(node.harness !== undefined ? { harness: node.harness } : {}),
						...(node.model !== undefined ? { model: node.model } : {}),
					};
		case "decision":
		case "value":
			return node.profile !== undefined
				? { profile: node.profile }
				: {
						...(node.decider !== undefined ? { decider: node.decider } : {}),
						...(node.model !== undefined ? { model: node.model } : {}),
					};
		case "call":
			return {};
	}
}

/** The node with a cascade of two tiers, both on what it runs on now: you change the second. */
export function withCascade<N extends CascadeNode>(node: N): N {
	const tier = firstTier(node);
	const {
		profile: _profile,
		model: _model,
		...rest
	} = node as N & { profile?: unknown; model?: unknown };
	const {
		harness: _harness,
		decider: _decider,
		...plain
	} = rest as typeof rest & {
		harness?: unknown;
		decider?: unknown;
	};
	return { ...plain, cascade: [tier, { ...tier }] } as unknown as N;
}

/** The node without its cascade, back on its first tier's profile or model. */
export function withoutCascade<N extends CascadeNode>(node: N): N {
	const { cascade, check: _check, ...rest } = node as N & { check?: string };
	const first = (cascade ?? []).find((tier) => !isPersonTier(tier)) as
		| (ModelTier & Record<string, unknown>)
		| undefined;
	if (node.type === "call" || first === undefined) return rest as N;
	const keep = ["profile", "harness", "model", "decider"] as const;
	const back = Object.fromEntries(
		keep.flatMap((key) =>
			first[key] !== undefined ? [[key, first[key]]] : [],
		),
	);
	if (node.type === "agent" && back.profile === undefined) {
		back.harness ??= "claude-code";
	}
	return { ...rest, ...back } as N;
}

/** The tiers of the node, changed by `change`. */
export function withTiers<N extends CascadeNode>(
	node: N,
	change: (tiers: Tier[]) => Tier[],
): N {
	return { ...node, cascade: change([...(node.cascade ?? [])]) } as N;
}
