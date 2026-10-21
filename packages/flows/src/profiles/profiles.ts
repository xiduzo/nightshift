import { z } from "zod";
import type { Flow } from "../document";
import {
	type AgentHarnessName,
	type AgentNode,
	agentHarnessSchema,
	cliNameSchema,
	effortSchema,
	nameSchema,
	permissionModeSchema,
} from "../nodes";

/**
 * Agent Profiles: a harness, a model and its tools under one name, defined on
 * the daemon. A node that names a profile takes its harness, model, effort
 * and permission mode unless it sets them itself; CLI tools and connections
 * add up. A run resolves the profiles of its flows when it starts, so the
 * run's copy holds plain nodes and a later change to a profile reaches the
 * next run, not this one.
 */

/**
 * What an Agent Profile sets on the nodes that name it. Defined once on the
 * daemon (the Agents page), never in a flow file.
 */
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

/** An Agent node with everything it runs with, after its profile is resolved. */
export type ResolvedAgentNode = AgentNode & {
	harness: AgentHarnessName;
	model: string;
	permissionMode: NonNullable<AgentNode["permissionMode"]>;
};

/** The node with its profile's values filled in. The `profile` name stays, for the record. */
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
 * Resolves the profiles of every Agent node of a flow. `missing` collects the
 * profile names it could not find, with their nodes; those nodes stay as
 * they are.
 */
export function resolveFlowProfiles(
	flow: Flow,
	profileFor: (name: string) => AgentProfileSettings | null,
	missing: Map<string, string[]> = new Map(),
): Flow {
	let changed = false;
	const nodes = flow.nodes.map((node) => {
		if (node.type !== "agent" || node.profile === undefined) return node;
		const profile = profileFor(node.profile);
		if (!profile) {
			const ids = missing.get(node.profile) ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			missing.set(node.profile, ids);
			return node;
		}
		changed = true;
		return resolveAgentNode(node, profile);
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
