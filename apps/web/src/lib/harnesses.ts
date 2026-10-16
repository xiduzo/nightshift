import type { AgentNode } from "@nightshift/flows";

export type HarnessName = NonNullable<AgentNode["harness"]>;

export type HarnessInfo = {
	value: HarnessName;
	label: string;
	/** One line under the picker: what this harness needs. */
	note: string;
	/** A new node, or a switch to this harness, starts with this model. */
	defaultModel: string;
	models: readonly string[];
};

/**
 * The coding-agent CLIs an Agent node can run on. Each runs on the daemon's
 * machine with its own login. Models are suggestions: any name the CLI
 * knows works.
 */
export const HARNESSES: readonly HarnessInfo[] = [
	{
		value: "claude-code",
		label: "Claude Code",
		note: "Runs claude with your Claude login. Model: an alias such as sonnet, or a full model id.",
		defaultModel: "sonnet",
		models: ["sonnet", "opus", "haiku"],
	},
	{
		value: "opencode",
		label: "OpenCode",
		note: "Model as provider/model. Needs an OpenCode 1.x build: 2.x does not work yet (NIGHTSHIFT_OPENCODE_BIN).",
		defaultModel: "anthropic/claude-sonnet-4-5",
		models: [
			"anthropic/claude-sonnet-4-5",
			"anthropic/claude-opus-4-5",
			"openai/gpt-5.2",
			"openai/gpt-5.1-codex",
			"google/gemini-3-pro-preview",
		],
	},
	{
		value: "codex",
		label: "Codex",
		note: "Unverified: tested against a fake codex only. Runs codex exec with your Codex login.",
		defaultModel: "gpt-5.3-codex",
		models: [
			"gpt-5.3-codex",
			"gpt-5.2-codex",
			"gpt-5.1-codex",
			"gpt-5.1-codex-mini",
			"gpt-5.1",
		],
	},
];

export function harnessInfo(name: HarnessName): HarnessInfo {
	return (
		HARNESSES.find((h) => h.value === name) ?? (HARNESSES[0] as HarnessInfo)
	);
}

/**
 * The node on another harness. A model from the old harness's suggestions
 * means nothing to the new one, so it moves to the new default; a model the
 * person typed stays.
 */
export function switchHarness(
	node: AgentNode,
	harness: HarnessName,
): AgentNode {
	if (node.harness === harness) return node;
	const before = node.harness ? harnessInfo(node.harness) : null;
	const model = node.model ?? "";
	const keepModel =
		model.trim() !== "" && before !== null && !before.models.includes(model);
	return {
		...node,
		harness,
		model: keepModel ? model : harnessInfo(harness).defaultModel,
	};
}
