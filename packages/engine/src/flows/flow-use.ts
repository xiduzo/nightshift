import {
	everyProfileOf,
	flowSecrets,
	isProfileRef,
	type ProjectFlowMap,
	runsAs,
	type Schedule,
	webhookSecretName,
} from "@nightshift/flows";
import type { SpaceFlows } from "./space-flows";

/** A flow file of a project of the Space. */
export type FlowRef = {
	projectId: string;
	projectName: string;
	flowName: string;
};

/**
 * Who uses what, from every flow of the Space's projects: the flows whose
 * Agent or Tool nodes name each connection, whose Agent nodes name each CLI
 * tool, that use each secret (`flowSecrets`: its nodes, and the flows and
 * kits it calls), by name, and the nodes that name each profile (Agents,
 * and Decisions and Values decided by a model), by `profileUseKey`.
 */
export type FlowUse = {
	connections: Map<string, FlowRef[]>;
	clis: Map<string, FlowRef[]>;
	/** By secret: the flows a webhook schedule with that secret starts. */
	webhooks: Map<string, FlowRef[]>;
	secrets: Map<string, FlowRef[]>;
	profiles: Map<string, (FlowRef & { nodeIds: string[] })[]>;
};

/** The key of a Device's profile in `FlowUse.profiles`. */
export function profileUseKey(deviceId: string, profileId: string): string {
	return `${deviceId}/${profileId}`;
}

/** What `flowUse` reads: the Space's projects and their flow files. */
export type FlowReader = {
	listProjects(): Promise<{ id: string; name: string }[]>;
	flows: Pick<SpaceFlows, "map">;
	listSchedules(projectId: string): Promise<{
		schedules: readonly Pick<Schedule, "flow" | "webhook">[];
	}>;
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
	const webhooks = new Map<string, FlowRef[]>();
	for (const project of await space.listProjects()) {
		const listed = await space
			.listSchedules(project.id)
			.catch(() => ({ schedules: [] }));
		for (const { flow, webhook } of listed.schedules) {
			const name = webhookSecretName(webhook?.secret ?? "");
			if (name === null || !flow) continue;
			webhooks.set(name, [
				...(webhooks.get(name) ?? []),
				{ projectId: project.id, projectName: project.name, flowName: flow },
			]);
		}
		const flows: ProjectFlowMap = await space.flows
			.map(project.id)
			.catch(() => ({}));
		for (const [flowName, flow] of Object.entries(flows)) {
			if (!flow) continue;
			const ref = {
				projectId: project.id,
				projectName: project.name,
				flowName,
			};
			// A cascade's tiers add their own connections and CLI tools.
			const agents = flow.nodes
				.flatMap(runsAs)
				.flatMap((n) => (n.type === "agent" ? [n] : []));
			const toolConnections = flow.nodes.flatMap((n) =>
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
			for (const name of flowSecrets(flow, { flows, name: flowName })) {
				secrets.set(name, [...(secrets.get(name) ?? []), ref]);
			}
			const byProfile = new Map<string, string[]>();
			for (const node of flow.nodes) {
				// A cascade names a profile per tier.
				for (const profile of everyProfileOf(node).filter(isProfileRef)) {
					const key = profileUseKey(profile.device, profile.profile);
					const ids = byProfile.get(key) ?? [];
					if (!ids.includes(node.id)) byProfile.set(key, [...ids, node.id]);
				}
			}
			for (const [name, nodeIds] of byProfile) {
				profiles.set(name, [
					...(profiles.get(name) ?? []),
					{ ...ref, nodeIds },
				]);
			}
		}
	}
	return { connections, clis, webhooks, secrets, profiles };
}
