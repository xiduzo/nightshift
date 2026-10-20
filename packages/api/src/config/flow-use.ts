import type { SpaceEngine } from "@nightshift/engine";

type FlowRef = { projectId: string; projectName: string; flowName: string };

/**
 * Who uses what, from every flow of the Space's projects: the flows whose Agent
 * or Tool nodes name each connection, whose Agent nodes name each CLI
 * tool, and the Agent nodes that name each profile.
 */
export async function flowUse(engine: SpaceEngine): Promise<{
	connections: Map<string, FlowRef[]>;
	clis: Map<string, FlowRef[]>;
	profiles: Map<string, (FlowRef & { nodeIds: string[] })[]>;
}> {
	const connections = new Map<string, FlowRef[]>();
	const clis = new Map<string, FlowRef[]>();
	const profiles = new Map<string, (FlowRef & { nodeIds: string[] })[]>();
	for (const project of await engine.listProjects()) {
		const files = await engine.listFlows(project.id).catch(() => []);
		for (const file of files) {
			const loaded = await engine
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
			const byProfile = new Map<string, string[]>();
			for (const node of agents) {
				if (node.profile === undefined) continue;
				byProfile.set(node.profile, [
					...(byProfile.get(node.profile) ?? []),
					node.id,
				]);
			}
			for (const [name, nodeIds] of byProfile) {
				profiles.set(name, [
					...(profiles.get(name) ?? []),
					{ ...ref, nodeIds },
				]);
			}
		}
	}
	return { connections, clis, profiles };
}
