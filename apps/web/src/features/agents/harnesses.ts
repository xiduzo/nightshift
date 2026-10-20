import {
	type AgentNode,
	type HarnessName as BuiltInHarnessName,
	type CustomAgent,
	customAgentSlug,
	isCustomHarness,
} from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/shared/api";

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
 * daemon's list is `HARNESS_ADAPTERS` in `@nightshift/agents`.
 */
export const HARNESSES: readonly HarnessInfo[] = [
	{
		value: "claude-code",
		label: "Claude Code",
		initials: "CC",
		note: "Uses your Claude login. Model: an alias such as sonnet, or a full model id.",
		defaultModel: "sonnet",
		models: ["sonnet", "opus", "haiku"],
		setting: "claudeBin",
		offMachine:
			"Prompts and your project's code go to Anthropic under your Claude login.",
	},
	{
		value: "opencode",
		label: "OpenCode",
		initials: "OC",
		note: "Model as provider/model. Needs OpenCode 1.x. Version 2.x does not work yet.",
		defaultModel: "anthropic/claude-sonnet-4-5",
		models: [
			"anthropic/claude-sonnet-4-5",
			"anthropic/claude-opus-4-5",
			"openai/gpt-5.2",
			"openai/gpt-5.1-codex",
			"google/gemini-3-pro-preview",
		],
		setting: "opencodeBin",
		offMachine:
			"Prompts and code go to the model provider OpenCode is set up with.",
	},
	{
		value: "codex",
		label: "Codex",
		initials: "CX",
		note: "Not fully tested yet. Uses your Codex login.",
		defaultModel: "gpt-5.3-codex",
		models: [
			"gpt-5.3-codex",
			"gpt-5.2-codex",
			"gpt-5.1-codex",
			"gpt-5.1-codex-mini",
			"gpt-5.1",
		],
		setting: "codexBin",
		offMachine: "Prompts and code go to OpenAI under your Codex login.",
	},
	{
		value: "grok-build",
		label: "Grok Build",
		initials: "GB",
		note: "Not fully tested yet. Uses your Grok login: run grok login once.",
		defaultModel: "grok-build",
		models: ["grok-build", "grok-build-0.1", "composer-2.5"],
		setting: "grokBin",
		offMachine: "Prompts and code go to xAI under your Grok login.",
	},
	{
		value: "copilot",
		label: "GitHub Copilot",
		initials: "GC",
		note: "Not fully tested yet. Uses your GitHub login. Model default uses the model Copilot is set to.",
		defaultModel: "default",
		models: ["default"],
		setting: "copilotBin",
		offMachine:
			"Prompts and code go to GitHub Copilot under your GitHub login.",
	},
	{
		value: "gemini",
		label: "Gemini CLI",
		initials: "GE",
		note: "Not fully tested yet. Uses your Gemini CLI login. Model default uses the model Gemini CLI is set to.",
		defaultModel: "default",
		models: ["default"],
		setting: "geminiBin",
		offMachine: "Prompts and code go to Google under your Gemini CLI login.",
	},
	{
		value: "cursor",
		label: "Cursor",
		initials: "CU",
		note: "Not fully tested yet. Uses your Cursor login: run agent login once.",
		defaultModel: "default",
		models: ["default"],
		setting: "cursorBin",
		offMachine: "Prompts and code go to Cursor under your Cursor login.",
	},
	{
		value: "pi",
		label: "pi",
		initials: "PI",
		note: "Needs pi 0.81 or later. Model as provider/model, for example ollama/qwen3-coder:latest. Model default uses the model pi is set to.",
		defaultModel: "default",
		models: ["default"],
		setting: "piBin",
		offMachine:
			"Prompts and code go to the model provider pi is set up with. With a local model, such as one in Ollama, they stay on this computer.",
	},
];

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
			: "This custom agent is not added on this computer. Add it under Agents, or pick another harness.",
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
		...orpc.harnesses.list.queryOptions(),
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
