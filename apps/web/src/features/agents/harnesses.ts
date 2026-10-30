import {
	type AgentNode,
	type HarnessName as BuiltInHarnessName,
	type CustomAgent,
	customAgentSlug,
	HARNESS_CATALOG,
	harnessNameSchema,
	isCustomHarness,
} from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";

import { harnessQueries } from "./queries";

/** A built-in harness, or a custom agent (`acp:<slug>`). */
export type HarnessName = NonNullable<AgentNode["harness"]>;
export type { BuiltInHarnessName };

export type HarnessInfo = {
	value: BuiltInHarnessName;
	label: string;
	/** Two letters for its tile. */
	initials: string;
	/** One line under the picker: what this harness needs. */
	note: string;
	/** A new node, or a switch to this harness, starts with this model. */
	defaultModel: string;
	models: readonly string[];
	/** The setting that holds its executable. */
	setting: `${string}Bin`;
	/** Where prompts and code go. */
	offMachine: string;
};

/**
 * The coding-agent CLIs an Agent node can run on. Each runs on the daemon's
 * machine with its own login. Models are suggestions: any name the CLI
 * knows works. `default` lets the agent use the model it is set to. The
 * facts are `HARNESS_CATALOG` in `@nightshift/flows`.
 */
export const HARNESSES: readonly HarnessInfo[] = harnessNameSchema.options.map(
	(name): HarnessInfo => {
		const facts = HARNESS_CATALOG[name];
		return {
			value: name,
			label: facts.label,
			initials: facts.initials,
			note: facts.note,
			defaultModel: facts.defaultModel,
			models: facts.suggestedModels,
			setting: facts.binSetting,
			offMachine: facts.offMachine,
		};
	},
);

/** What the pickers show for a harness: a built-in one, or a custom agent. */
export type HarnessView = Omit<HarnessInfo, "value" | "setting"> & {
	value: HarnessName;
	/** Null for a custom agent: its command is its own. */
	setting: HarnessInfo["setting"] | null;
};

/**
 * A custom agent as the pickers show it. `agent` is undefined on a computer
 * that has not added it: its slug is the label then.
 */
export function customAgentInfo(
	name: `acp:${string}`,
	agent: Pick<CustomAgent, "label"> | undefined,
): HarnessView {
	const label = agent?.label ?? customAgentSlug(name);
	return {
		value: name,
		label: agent ? label : `${label} (not added)`,
		initials: label.slice(0, 2).toUpperCase(),
		note: agent
			? `Model default uses the model ${label} is set to. You can type another model it offers.`
			: "This computer does not have this custom agent. Add it under Agents, or pick another harness.",
		defaultModel: "default",
		models: ["default"],
		setting: null,
		offMachine: `Prompts and code go wherever ${label} sends them.`,
	};
}

/** A harness's view. Pass the custom agents to show a custom agent's own label. */
export function harnessInfo(
	name: HarnessName,
	customAgents: readonly CustomAgent[] = [],
): HarnessView {
	if (isCustomHarness(name)) {
		const slug = customAgentSlug(name);
		return customAgentInfo(
			name,
			customAgents.find((a) => a.slug === slug),
		);
	}
	return (
		HARNESSES.find((h) => h.value === name) ?? (HARNESSES[0] as HarnessInfo)
	);
}

export const isHarnessName = (name: string): name is HarnessName =>
	HARNESSES.some((h) => h.value === name) ||
	/^acp:[a-z0-9][a-z0-9-]{0,39}$/.test(name);

/**
 * The custom agents added on this computer: any coding agent that speaks
 * the Agent Client Protocol. Empty until the daemon answers.
 */
export function useCustomAgents(): CustomAgent[] {
	const query = useQuery({
		...harnessQueries.list(),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	return (query.data ?? []).flatMap((h) => (h.custom ? [h.custom] : []));
}

/**
 * The node on another harness. A model from the old harness's suggestions
 * means nothing to the new one, so it moves to the new default; a model the
 * person typed stays.
 */
export function switchHarness(
	node: AgentNode,
	harness: HarnessName,
	customAgents: readonly CustomAgent[] = [],
): AgentNode {
	if (node.harness === harness) return node;
	const before = node.harness ? harnessInfo(node.harness, customAgents) : null;
	const model = node.model ?? "";
	const keepModel =
		model.trim() !== "" && before !== null && !before.models.includes(model);
	return {
		...node,
		harness,
		model: keepModel ? model : harnessInfo(harness, customAgents).defaultModel,
	};
}
