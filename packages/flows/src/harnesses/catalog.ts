import {
	type AgentHarnessName,
	type HarnessName,
	isCustomHarness,
} from "../nodes";

/**
 * What a person sees of each built-in harness, as pure data: the web app's
 * pickers, the canvas and new nodes read it before the API answers, and
 * the harness records of `@nightshift/agents` start from it. A harness's
 * name is `harnessNameSchema` (in `nodes/agent.ts`).
 */
export type HarnessCatalogEntry = {
	name: HarnessName;
	/** The display name, for example "Claude Code". */
	label: string;
	/** Two letters for its tile. */
	initials: string;
	/** One line under the picker: what this harness needs. */
	note: string;
	/** A new node, or a switch to this harness, starts with this model. */
	defaultModel: string;
	/**
	 * The short list of models the editor suggests. Any other model the CLI
	 * knows works too. The adapter's full list is in `@nightshift/agents`.
	 */
	suggestedModels: readonly string[];
	/** Where prompts and code go. */
	offMachine: string;
	/** The setting of this computer that holds the path of its CLI. */
	binSetting: `${string}Bin`;
	/** Takes Night Shift's own tools in a session (`harnessTakesTools`). */
	tools: boolean;
};

/** The model name that leaves the choice to the agent's own setting. */
const AGENT_DEFAULT = "default";

/** Every built-in harness, by name, in the order of `harnessNameSchema`. */
export const HARNESS_CATALOG = {
	"claude-code": {
		name: "claude-code",
		label: "Claude Code",
		initials: "CC",
		note: "Uses your Claude login. Model: an alias such as sonnet, or a full model id.",
		defaultModel: "sonnet",
		suggestedModels: ["sonnet", "opus", "haiku"],
		offMachine:
			"Prompts and your project's code go to Anthropic under your Claude login.",
		binSetting: "claudeBin",
		tools: true,
	},
	opencode: {
		name: "opencode",
		label: "OpenCode",
		initials: "OC",
		note: "Needs OpenCode 1.x. Version 2.x does not work yet. Model: provider/model.",
		defaultModel: "anthropic/claude-sonnet-4-5",
		suggestedModels: [
			"anthropic/claude-sonnet-4-5",
			"anthropic/claude-opus-4-5",
			"openai/gpt-5.2",
			"openai/gpt-5.1-codex",
			"google/gemini-3-pro-preview",
		],
		offMachine: "Prompts and code go to the model provider set in OpenCode.",
		binSetting: "opencodeBin",
		tools: true,
	},
	codex: {
		name: "codex",
		label: "Codex",
		initials: "CX",
		note: "Not fully tested yet. Uses your Codex login.",
		defaultModel: "gpt-5.3-codex",
		suggestedModels: [
			"gpt-5.3-codex",
			"gpt-5.2-codex",
			"gpt-5.1-codex",
			"gpt-5.1-codex-mini",
			"gpt-5.1",
		],
		offMachine: "Prompts and code go to OpenAI under your Codex login.",
		binSetting: "codexBin",
		tools: true,
	},
	"grok-build": {
		name: "grok-build",
		label: "Grok Build",
		initials: "GB",
		note: "Not fully tested yet. Run grok login once to use your Grok login.",
		defaultModel: "grok-build",
		suggestedModels: ["grok-build", "grok-build-0.1", "composer-2.5"],
		offMachine: "Prompts and code go to xAI under your Grok login.",
		binSetting: "grokBin",
		tools: false,
	},
	copilot: {
		name: "copilot",
		label: "GitHub Copilot",
		initials: "GC",
		note: "Not fully tested yet. Uses your GitHub login. Model default: the model set in Copilot.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine:
			"Prompts and code go to GitHub Copilot under your GitHub login.",
		binSetting: "copilotBin",
		tools: true,
	},
	gemini: {
		name: "gemini",
		label: "Gemini CLI",
		initials: "GE",
		note: "Not fully tested yet. Uses your Gemini CLI login. Model default: the model set in Gemini CLI.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine: "Prompts and code go to Google under your Gemini CLI login.",
		binSetting: "geminiBin",
		tools: true,
	},
	cursor: {
		name: "cursor",
		label: "Cursor",
		initials: "CU",
		note: "Not fully tested yet. Run agent login once to use your Cursor login.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine: "Prompts and code go to Cursor under your Cursor login.",
		binSetting: "cursorBin",
		tools: true,
	},
	pi: {
		name: "pi",
		label: "pi",
		initials: "PI",
		note: "Needs pi 0.81 or later. Model: provider/model, for example ollama/qwen3-coder:latest.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine:
			"Prompts and code go to the model provider set in pi. With a local model, they stay on this computer.",
		binSetting: "piBin",
		tools: false,
	},
} as const satisfies { [K in HarnessName]: HarnessCatalogEntry & { name: K } };

/**
 * Whether a harness takes Night Shift's own tools in a session. The chat
 * of the assistant needs them to read the draft and propose a flow: pi
 * drops MCP, and Grok Build reports in text. A custom agent speaks ACP
 * with MCP, so it takes them.
 */
export function harnessTakesTools(name: AgentHarnessName): boolean {
	return isCustomHarness(name) || HARNESS_CATALOG[name].tools;
}
