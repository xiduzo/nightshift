import type { Flow } from "../flow";
import { isProfileRef, type ProfileRef, sameProfileRef } from "../nodes";
import { everyProfileOf, runsAs } from "../profiles";
import { type CalledFlowsOptions, walkCalledFlows } from "./called-flows";

/**
 * What a flow names of a Device's configuration: connections, CLI tools
 * and profiles. Their secrets live on that Device, so the Secrets pages
 * count the flows that name them too.
 */
export type FlowConfigUse = {
	/** The connections its Agent and Tool nodes name. */
	connections: string[];
	/** The CLI tools its Agent nodes name. */
	clis: string[];
	/** The profiles its nodes name: their own, each tier's, and each backup. */
	profiles: ProfileRef[];
};

/**
 * The connections, CLI tools and profiles a flow names, each once: those
 * of its own nodes (each tier of a cascade adds its own), and those of
 * every flow and kit it calls (`walkCalledFlows`). A profile name left
 * from format 6 names no profile.
 *
 * `flows`: the project's flow files, for the flows it calls. `name`: the
 * flow's own file name, so that a call back to it adds nothing.
 */
export function flowConfigUse(
	flow: Flow,
	options: CalledFlowsOptions = {},
): FlowConfigUse {
	const connections = new Set<string>();
	const clis = new Set<string>();
	const profiles: ProfileRef[] = [];
	walkCalledFlows(flow, options, (node) => {
		if (node.type === "tool") connections.add(node.connection);
		for (const agent of runsAs(node)) {
			if (agent.type !== "agent") continue;
			for (const name of agent.connections ?? []) connections.add(name);
			for (const name of agent.clis ?? []) clis.add(name);
		}
		for (const profile of everyProfileOf(node)) {
			if (!isProfileRef(profile)) continue;
			if (!profiles.some((known) => sameProfileRef(known, profile))) {
				profiles.push(profile);
			}
		}
	});
	return { connections: [...connections], clis: [...clis], profiles };
}
