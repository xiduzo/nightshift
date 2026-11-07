import type { Flow, FlowNode } from "../flow";
import {
	type AgentHarnessName,
	type AgentNode,
	type AgentTier,
	calledFlowNames,
	isPersonTier,
	type ProfileRef,
} from "../nodes";

/**
 * The agents a flow names, and the person's own profiles in their place.
 * A flow from elsewhere (a starter, a shared file) names each agent by its
 * harness and model, which the reader may not have. Before Night Shift
 * saves the reader's copy, they pick one of their Agent Profiles for each
 * agent. The flow format stays the same: a mapped node or tier names the
 * profile, as when a person picks it in the editor.
 *
 * A node or tier that names a profile already is not an agent here: the
 * profile is a setup in the Space, and the editor asks for another one
 * when its Device is gone.
 */

/** An agent a flow names on an Agent node or a tier of its cascade: a harness and its model. */
export type FlowAgent = { harness: AgentHarnessName; model: string };

/** One agent of a flow, and the profile that takes its steps. */
export type AgentChoice = { agent: FlowAgent; profile: ProfileRef };

/** The agent's key, and how a terminal names it: `claude-code:sonnet`. */
export function agentKey(agent: FlowAgent): string {
	return `${agent.harness}:${agent.model}`;
}

/** What names an agent: an Agent node without a cascade, or a tier. */
type AgentFields = Pick<AgentTier, "profile" | "harness" | "model">;

/** The harness and model it names itself, or null when it names a profile or misses one of them. */
function ownAgent(fields: AgentFields): FlowAgent | null {
	if (fields.profile !== undefined) return null;
	const { harness, model } = fields;
	if (harness === undefined || model === undefined) return null;
	return { harness, model };
}

/** The agents of a node: an Agent's own, else each model tier's of its cascade. */
function nodeAgents(node: FlowNode): FlowAgent[] {
	if (node.type !== "agent") return [];
	if (node.cascade === undefined) {
		const own = ownAgent(node);
		return own === null ? [] : [own];
	}
	return node.cascade.flatMap((tier) => {
		if (isPersonTier(tier)) return [];
		const own = ownAgent(tier);
		return own === null ? [] : [own];
	});
}

/**
 * The distinct agents of the flows, in the order they first appear: each
 * Agent node's, and each tier's of its cascade. With `called`, the flows
 * of a project by name, it also lists the agents of the flows they call
 * (a Call node and the tiers of its cascade), each flow once. A kit is
 * Night Shift's own, so it is not in `called`.
 */
export function flowAgents(
	flows: readonly Flow[],
	called?: Readonly<Record<string, Flow | null>>,
): FlowAgent[] {
	const agents = new Map<string, FlowAgent>();
	const seen = new Set<Flow>();
	const visit = (flow: Flow) => {
		if (seen.has(flow)) return;
		seen.add(flow);
		for (const node of flow.nodes) {
			for (const agent of nodeAgents(node)) {
				const key = agentKey(agent);
				if (!agents.has(key)) agents.set(key, agent);
			}
			if (node.type !== "call" || called === undefined) continue;
			for (const name of calledFlowNames(node)) {
				const next = Object.hasOwn(called, name) ? called[name] : null;
				if (next) visit(next);
			}
		}
	};
	for (const flow of flows) visit(flow);
	return [...agents.values()];
}

/**
 * The profile that takes an agent until the person chooses one: the first
 * profile with the same harness and model, else the first with the same
 * harness, else the first profile. Undefined without profiles.
 */
export function prefilledProfile<P extends { harness: string; model: string }>(
	agent: FlowAgent,
	profiles: readonly P[],
): P | undefined {
	return (
		profiles.find(
			(profile) =>
				profile.harness === agent.harness && profile.model === agent.model,
		) ??
		profiles.find((profile) => profile.harness === agent.harness) ??
		profiles[0]
	);
}

/**
 * The flow with each chosen agent replaced by its profile, on every Agent
 * node and tier that names that agent. The node or tier names the profile
 * and drops its own harness and model. Its other settings stay, as the
 * flow chose them for the step: effort, permission mode, tools. The node
 * names no Device of its own then, because the profile's Device runs it.
 * An agent without a choice stays as it is. The same flow when nothing
 * changes.
 */
export function withAgentProfiles(
	flow: Flow,
	choices: readonly AgentChoice[],
): Flow {
	const chosen = new Map(
		choices.map((choice) => [agentKey(choice.agent), choice.profile]),
	);
	if (chosen.size === 0) return flow;
	const profileOf = (fields: AgentFields): ProfileRef | undefined => {
		const own = ownAgent(fields);
		return own === null ? undefined : chosen.get(agentKey(own));
	};
	let changed = false;
	const nodes = flow.nodes.map((node) => {
		if (node.type !== "agent") return node;
		const mapped = mappedAgentNode(node, profileOf);
		if (mapped !== node) changed = true;
		return mapped;
	});
	return changed ? { ...flow, nodes } : flow;
}

/** The Agent node with its agents on their chosen profiles, or the same node. */
function mappedAgentNode(
	node: AgentNode,
	profileOf: (fields: AgentFields) => ProfileRef | undefined,
): AgentNode {
	if (node.cascade === undefined) {
		const profile = profileOf(node);
		if (profile === undefined) return node;
		const { harness: _h, model: _m, device: _d, ...rest } = node;
		return { ...rest, profile };
	}
	let changed = false;
	const cascade = node.cascade.map((tier) => {
		if (isPersonTier(tier)) return tier;
		const profile = profileOf(tier);
		if (profile === undefined) return tier;
		changed = true;
		const { harness: _h, model: _m, ...rest } = tier;
		return { ...rest, profile };
	});
	if (!changed) return node;
	// A tier's profile runs its tries on the profile's Device.
	const { device: _d, ...rest } = node;
	return { ...rest, cascade };
}
