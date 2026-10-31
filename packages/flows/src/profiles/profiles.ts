import { z } from "zod";
import type { Flow, FlowNode } from "../flow";
import {
	type AgentHarnessName,
	type AgentNode,
	agentHarnessSchema,
	canMakeValue,
	cliNameSchema,
	type DecisionNode,
	deciderNameSchema,
	effortSchema,
	isProfileRef,
	type NodeProfile,
	nameSchema,
	permissionModeSchema,
	type ValueNode,
	valueDeciderNameSchema,
} from "../nodes";

/**
 * Profiles: a setup that nodes name in `profile`. An Agent Profile holds a
 * harness, a model and its tools, for Agent nodes. A Model Profile holds a
 * decider and its model, for a Decision or a Value decided by a model. A
 * profile belongs to one Device (ADR 3): a node names it by the Device and
 * the profile's id (`ProfileRef`), and its name is a label. A project has
 * no profiles of its own: the import on upgrade gives the profiles of an
 * old project folder to the importing Device.
 *
 * A node that names a profile takes its settings unless it sets them
 * itself; CLI tools and connections add up. A run resolves the profiles of
 * its flows when it starts, so the run's copy holds plain nodes and a later
 * change to a profile reaches the next run, not this one.
 */

/** What an Agent Profile sets on the Agent nodes that name it. */
export const agentProfileSettingsSchema = z.object({
	harness: agentHarnessSchema,
	model: z.string().trim().min(1),
	effort: effortSchema.optional(),
	permissionMode: permissionModeSchema,
	/** CLI tools (programs on this daemon) by name. */
	clis: z.array(cliNameSchema).default([]),
	/** Connections (MCP servers on this daemon) by name. */
	connections: z.array(nameSchema).default([]),
});
export type AgentProfileSettings = z.infer<typeof agentProfileSettingsSchema>;

export const agentProfileSchema = agentProfileSettingsSchema.extend({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

/**
 * What a Model Profile sets on the Decisions and Values decided by a model
 * that name it: the decider, and its model. Without a model, each node
 * uses the decider's default for what it asks (a decision or a value).
 */
export const modelProfileSettingsSchema = z.object({
	decider: deciderNameSchema,
	model: z.string().trim().min(1).optional(),
});
export type ModelProfileSettings = z.infer<typeof modelProfileSettingsSchema>;

export const modelProfileSchema = modelProfileSettingsSchema.extend({
	name: nameSchema,
	description: z.string().trim().max(500).optional(),
});
export type ModelProfile = z.infer<typeof modelProfileSchema>;

/** Either kind of profile's settings: an agent's (`harness`) or a model's (`decider`). */
export const profileSettingsSchema = z.union([
	agentProfileSettingsSchema,
	modelProfileSettingsSchema,
]);
export type ProfileSettings = AgentProfileSettings | ModelProfileSettings;

/** Either kind of profile, with its name. */
export const profileSchema = z.union([agentProfileSchema, modelProfileSchema]);
export type Profile = AgentProfile | ModelProfile;

/** Whether the profile is an Agent Profile: it names a harness. */
export function isAgentProfile<P extends ProfileSettings>(
	profile: P,
): profile is Extract<P, AgentProfileSettings> {
	return "harness" in profile;
}

/**
 * The profile a node names, when its kind reads one: an Agent, or a
 * Decision or a Value decided by a model. A `ProfileRef`, or a name left
 * from format 6 that must be picked again.
 */
export function profileOf(node: FlowNode): NodeProfile | undefined {
	if (node.type === "agent") return node.profile;
	if (node.type === "decision" || node.type === "value") {
		return node.by === "model" ? node.profile : undefined;
	}
	return undefined;
}

/**
 * Whether a node says itself where its step runs: its profile names a
 * Device, or it names one (`device`). A node that does not runs where the
 * Subflow around it runs, else on the run's Device.
 */
export function placesItself(node: FlowNode): boolean {
	return (
		isProfileRef(profileOf(node)) ||
		("device" in node && node.device !== undefined)
	);
}

/**
 * A node's profile as words, when nothing better is known: a name left
 * from format 6 as it is, a `ProfileRef` by its profile's id. The empty
 * string for none.
 */
export function profileLabel(profile: NodeProfile | undefined): string {
	if (profile === undefined) return "";
	return isProfileRef(profile) ? profile.profile : profile;
}

/** An Agent node with everything it runs with, after its profile is resolved. */
export type ResolvedAgentNode = AgentNode & {
	harness: AgentHarnessName;
	model: string;
	permissionMode: NonNullable<AgentNode["permissionMode"]>;
};

/** The node with its profile's values filled in. The `profile` stays, for the record. */
export function resolveAgentNode(
	node: AgentNode,
	profile: AgentProfileSettings,
): AgentNode {
	const clis = [...new Set([...profile.clis, ...(node.clis ?? [])])];
	const connections = [
		...new Set([...profile.connections, ...(node.connections ?? [])]),
	];
	const resolved: AgentNode = {
		...node,
		harness: node.harness ?? profile.harness,
		model: node.model ?? profile.model,
		permissionMode: node.permissionMode ?? profile.permissionMode,
	};
	const effort = node.effort ?? profile.effort;
	if (effort !== undefined) resolved.effort = effort;
	if (clis.length > 0) resolved.clis = clis;
	if (connections.length > 0) resolved.connections = connections;
	return resolved;
}

/**
 * A Decision or a Value with its Model Profile filled in: the node's own
 * decider wins, and so does its own model. A node that picks another
 * decider than the profile's does not take the profile's model, as a model
 * belongs to its decider. The `profile` stays, for the record.
 */
export function resolveModelNode<N extends DecisionNode | ValueNode>(
	node: N,
	profile: ModelProfileSettings,
): N {
	const decider = node.decider ?? profile.decider;
	const model =
		node.model ?? (decider === profile.decider ? profile.model : undefined);
	return {
		...node,
		decider,
		...(model !== undefined ? { model } : {}),
	};
}

/**
 * The node with the profile it names filled in, or why the profile does
 * not fit it: an Agent needs an Agent Profile, a Decision or a Value a
 * Model Profile, and a Value one whose decider can make a value.
 */
export function resolveNodeProfile(
	node: FlowNode,
	profile: ProfileSettings,
	/** The profile's name, for the problem. Default: what the node names. */
	label?: string,
): { node: FlowNode } | { problem: string } {
	const name = label ?? profileLabel(profileOf(node));
	if (node.type === "agent") {
		if (isAgentProfile(profile))
			return { node: resolveAgentNode(node, profile) };
		return {
			problem: `The Agent node "${node.id}" names the profile "${name}", which is for Decision and Value nodes. Pick an agent profile.`,
		};
	}
	if (node.type !== "decision" && node.type !== "value") return { node };
	if (isAgentProfile(profile)) {
		return {
			problem: `The ${node.type === "decision" ? "Decision" : "Value"} node "${node.id}" names the profile "${name}", which is for Agent nodes. Pick a model profile.`,
		};
	}
	const resolved = resolveModelNode<DecisionNode | ValueNode>(node, profile);
	if (
		resolved.type === "value" &&
		resolved.decider !== undefined &&
		!canMakeValue(resolved.decider)
	) {
		return {
			problem: `The Value node "${node.id}" uses the profile "${name}", whose decider cannot make a value. Pick a profile on ${valueDeciderNameSchema.options.join(", ")}.`,
		};
	}
	return { node: resolved };
}

/**
 * Resolves the profiles of every node of a flow that names one. `missing`
 * collects the profile names it could not find, with their nodes, and
 * `problems` the profiles that do not fit their node; those nodes stay as
 * they are.
 */
export function resolveFlowProfiles(
	flow: Flow,
	profileFor: (profile: NodeProfile) => ProfileSettings | null,
	missing: Map<string, string[]> = new Map(),
	problems: string[] = [],
): Flow {
	let changed = false;
	const nodes = flow.nodes.map((node) => {
		const named = profileOf(node);
		if (named === undefined) return node;
		const name = profileLabel(named);
		const profile = profileFor(named);
		if (!profile) {
			const ids = missing.get(name) ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			missing.set(name, ids);
			return node;
		}
		const resolved = resolveNodeProfile(node, profile);
		if ("problem" in resolved) {
			problems.push(resolved.problem);
			return node;
		}
		changed = true;
		return resolved.node;
	});
	return changed ? { ...flow, nodes } : flow;
}

/** The node's run settings, or null when a harness, model or permission mode is missing. */
export function resolvedAgent(node: AgentNode): ResolvedAgentNode | null {
	const { harness, model, permissionMode } = node;
	if (harness === undefined || model === undefined) return null;
	if (permissionMode === undefined) return null;
	return { ...node, harness, model, permissionMode };
}
