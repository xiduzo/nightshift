import {
	type FlowListItem,
	type LoadedFlow,
	profileOf,
} from "@nightshift/flows";

/** A flow file of a project of the Space. */
export type FlowRef = {
	projectId: string;
	projectName: string;
	flowName: string;
};

/**
 * Who uses what, from every flow of the Space's projects: the flows whose
 * Agent or Tool nodes name each connection, whose Agent nodes name each CLI
 * tool, whose Command nodes name each secret, and the nodes that name each
 * profile (Agents, and Decisions and Values decided by a model). By name.
 */
export type FlowUse = {
	connections: Map<string, FlowRef[]>;
	clis: Map<string, FlowRef[]>;
	secrets: Map<string, FlowRef[]>;
	profiles: Map<string, (FlowRef & { nodeIds: string[] })[]>;
};

/** What `flowUse` reads: the Space's projects and their flow files. */
export type FlowReader = {
	listProjects(): Promise<{ id: string; name: string }[]>;
	listFlows(projectId: string): Promise<FlowListItem[]>;
	getFlow(projectId: string, name: string): Promise<LoadedFlow>;
};

/**
 * Reads every flow of every project of the Space. A project or a flow that
 * cannot be read uses nothing.
 */
export async function flowUse(space: FlowReader): Promise<FlowUse> {
	const connections = new Map<string, FlowRef[]>();
	const clis = new Map<string, FlowRef[]>();
	const secrets = new Map<string, FlowRef[]>();
	const profiles = new Map<string, (FlowRef & { nodeIds: string[] })[]>();
	for (const project of await space.listProjects()) {
		const files = await space.listFlows(project.id).catch(() => []);
		for (const file of files) {
			const loaded = await space
				.getFlow(project.id, file.name)
				.catch(() => null);
			const ref = {
				projectId: project.id,
				projectName: project.name,
				flowName: file.name,
			};
			const agents = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "agent" ? [n] : [],
			);
			const toolConnections = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "tool" ? [n.connection] : [],
			);
			for (const name of new Set([
				...agents.flatMap((n) => n.connections ?? []),
				...toolConnections,
			])) {
				connections.set(name, [...(connections.get(name) ?? []), ref]);
			}
			for (const name of new Set(agents.flatMap((n) => n.clis ?? []))) {
				clis.set(name, [...(clis.get(name) ?? []), ref]);
			}
			const commandSecrets = (loaded?.flow?.nodes ?? []).flatMap((n) =>
				n.type === "command" ? (n.secrets ?? []) : [],
			);
			for (const name of new Set(commandSecrets)) {
				secrets.set(name, [...(secrets.get(name) ?? []), ref]);
			}
			const byProfile = new Map<string, string[]>();
			for (const node of loaded?.flow?.nodes ?? []) {
				const profile = profileOf(node);
				if (profile === undefined) continue;
				byProfile.set(profile, [...(byProfile.get(profile) ?? []), node.id]);
			}
			for (const [name, nodeIds] of byProfile) {
				profiles.set(name, [
					...(profiles.get(name) ?? []),
					{ ...ref, nodeIds },
				]);
			}
		}
	}
	return { connections, clis, secrets, profiles };
}
