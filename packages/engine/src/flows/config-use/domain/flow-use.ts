import {
	everyProfileOf,
	flowConfigUse,
	flowSecrets,
	type ProjectFlowMap,
	type Schedule,
	webhookSecretName,
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
 * tool (`flowConfigUse`), and that use each secret (`flowSecrets`), by
 * name. Each counts the flows and kits a flow calls too. And the nodes
 * that name each profile (Agents, and Decisions and Values decided by a
 * model), by `profileUseKey`.
 */
export type FlowUse = {
	connections: Map<string, FlowRef[]>;
	clis: Map<string, FlowRef[]>;
	/** By secret: the flows a webhook schedule with that secret starts. */
	webhooks: Map<string, FlowRef[]>;
	secrets: Map<string, FlowRef[]>;
	/** The flow's own nodes that name the profile. */
	profiles: Map<string, (FlowRef & { nodeIds: string[] })[]>;
	/**
	 * By `profileUseKey`: the flows that use the profile, through their own
	 * nodes or through a flow they call. What reads its secrets counts them.
	 */
	profileFlows: Map<string, FlowRef[]>;
};

/** The key of a Device's profile in `FlowUse.profiles`. */
export function profileUseKey(deviceId: string, profileId: string): string {
	return `${deviceId}/${profileId}`;
}

/** The schedules of a project, as `flowUse` reads them. */
type ScheduleUse = Pick<Schedule, "flow" | "webhook">;

/** What `readSpaceFlows` reads: the Space's projects and their flow files. */
export type SpaceFlowReader = {
	listProjects(): Promise<{ id: string; name: string }[]>;
	flows: { map(projectId: string): Promise<ProjectFlowMap> };
	listSchedules(projectId: string): Promise<{
		schedules: readonly ScheduleUse[];
	}>;
};

/** One project of the Space as read: its schedules and its flows. */
export type ProjectFlowFacts = {
	project: { id: string; name: string };
	schedules: readonly ScheduleUse[];
	flows: ProjectFlowMap;
};

/**
 * Reads every project of the Space, one after the other: its schedules,
 * then its flows. A project whose schedules or flows cannot be read has
 * none.
 */
export async function readSpaceFlows(
	space: SpaceFlowReader,
): Promise<ProjectFlowFacts[]> {
	const facts: ProjectFlowFacts[] = [];
	for (const project of await space.listProjects()) {
		const listed = await space
			.listSchedules(project.id)
			.catch(() => ({ schedules: [] }));
		const flows: ProjectFlowMap = await space.flows
			.map(project.id)
			.catch(() => ({}));
		facts.push({ project, schedules: listed.schedules, flows });
	}
	return facts;
}

/** What every flow of the Space's projects uses. A flow that does not load uses nothing. */
export function flowUse(projects: readonly ProjectFlowFacts[]): FlowUse {
	const connections = new Map<string, FlowRef[]>();
	const clis = new Map<string, FlowRef[]>();
	const secrets = new Map<string, FlowRef[]>();
	const profiles = new Map<string, (FlowRef & { nodeIds: string[] })[]>();
	const profileFlows = new Map<string, FlowRef[]>();
	const webhooks = new Map<string, FlowRef[]>();
	for (const { project, schedules, flows } of projects) {
		for (const { flow, webhook } of schedules) {
			const name = webhookSecretName(webhook?.secret ?? "");
			if (name === null || !flow) continue;
			webhooks.set(name, [
				...(webhooks.get(name) ?? []),
				{ projectId: project.id, projectName: project.name, flowName: flow },
			]);
		}
		for (const [flowName, flow] of Object.entries(flows)) {
			if (!flow) continue;
			const ref = {
				projectId: project.id,
				projectName: project.name,
				flowName,
			};
			const reach = { flows, name: flowName };
			const named = flowConfigUse(flow, reach);
			for (const name of named.connections) add(connections, name, ref);
			for (const name of named.clis) add(clis, name, ref);
			for (const profile of named.profiles) {
				add(profileFlows, profileUseKey(profile.device, profile.profile), ref);
			}
			for (const name of flowSecrets(flow, reach)) add(secrets, name, ref);
			const byProfile = new Map<string, string[]>();
			for (const node of flow.nodes) {
				// A cascade names a profile per tier.
				for (const profile of everyProfileOf(node)) {
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
	return { connections, clis, webhooks, secrets, profiles, profileFlows };
}

/** Adds `ref` to the flows of `key`. */
function add(map: Map<string, FlowRef[]>, key: string, ref: FlowRef): void {
	map.set(key, [...(map.get(key) ?? []), ref]);
}
