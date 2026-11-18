import { harnessNoun } from "@nightshift/agents/harness-facts";
import type { AgentHarnessName } from "@nightshift/agents/types";
import type { AgentNode, FlowNode } from "@nightshift/flows";
import { harnessLabel, onDevice, type Requirement } from "../../context";

/**
 * What an Agent node needs of a Device before a run starts: its CLI tools
 * and its harness. The Agent kind lists them (`AGENT.requirements`).
 */

/** Every CLI tool an Agent node uses is on the Device. */
export const cliToolsInstalled: Requirement<AgentNode> = (nodes, has) => {
	const notFound = [...new Set(nodes.flatMap(programsOf))].filter(
		(name) => (has.programs[name] ?? null) === null,
	);
	if (notFound.length === 0) return null;
	return notFound
		.map((name) =>
			has.elsewhere === null
				? `The flow uses the CLI tool "${name}", but this computer does not have it. Install ${name}, or remove it from the flow.`
				: `The flow uses the CLI tool "${name}" on ${has.elsewhere}, but that device does not have it. Install ${name} there, or choose another device.`,
		)
		.join(" ");
};

/**
 * The programs an Agent node's agent may run: its CLI tools. One the
 * Device defines brings its login; any other only needs to be there.
 */
export function programsOf(node: AgentNode): string[] {
	return node.clis ?? [];
}

/** Agent nodes run on harnesses the Device has added. */
export const harnessesAdded: Requirement<AgentNode> = (nodes, has) => {
	const missing = missingHarnesses(nodes, new Set(has.harnesses));
	if (missing.length === 0) return null;
	return missing
		.map(
			({ harness, nodeIds }) =>
				`The flow has ${nodeIds.length === 1 ? "an Agent node" : "Agent nodes"} on ${harnessLabel(harness)} (${nodeIds.join(", ")}), but no ${harnessNoun(harness)} is added${onDevice(has)}. Add it under Agents.`,
		)
		.join(" ");
};

/** The harnesses the Agent nodes name that the Device has not added, with their nodes. */
function missingHarnesses(
	nodes: readonly AgentNode[],
	added: ReadonlySet<AgentHarnessName>,
): { harness: AgentHarnessName; nodeIds: string[] }[] {
	const missing = new Map<AgentHarnessName, string[]>();
	for (const node of nodes) {
		if (node.harness === undefined) continue;
		if (added.has(node.harness)) continue;
		const ids = missing.get(node.harness) ?? [];
		if (!ids.includes(node.id)) ids.push(node.id);
		missing.set(node.harness, ids);
	}
	return [...missing].map(([harness, nodeIds]) => ({ harness, nodeIds }));
}

/** The names the nodes list that the Device does not have, with their nodes. */
export function missingNames<N extends FlowNode>(
	nodes: readonly N[],
	listed: (node: N) => readonly string[],
	names: ReadonlySet<string>,
): { name: string; nodeIds: string[] }[] {
	const missing = new Map<string, string[]>();
	for (const node of nodes) {
		for (const name of listed(node)) {
			if (names.has(name)) continue;
			const ids = missing.get(name) ?? [];
			if (!ids.includes(node.id)) ids.push(node.id);
			missing.set(name, ids);
		}
	}
	return [...missing].map(([name, nodeIds]) => ({ name, nodeIds }));
}
