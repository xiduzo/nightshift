import type { HarnessName } from "../nodes";

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
	},
	opencode: {
		name: "opencode",
		label: "OpenCode",
		initials: "OC",
		note: "Model as provider/model. Needs OpenCode 1.x. Version 2.x does not work yet.",
		defaultModel: "anthropic/claude-sonnet-4-5",
		suggestedModels: [
			"anthropic/claude-sonnet-4-5",
			"anthropic/claude-opus-4-5",
			"openai/gpt-5.2",
			"openai/gpt-5.1-codex",
			"google/gemini-3-pro-preview",
		],
		offMachine:
			"Prompts and code go to the model provider OpenCode is set up with.",
		binSetting: "opencodeBin",
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
	},
	"grok-build": {
		name: "grok-build",
		label: "Grok Build",
		initials: "GB",
		note: "Not fully tested yet. Uses your Grok login: run grok login once.",
		defaultModel: "grok-build",
		suggestedModels: ["grok-build", "grok-build-0.1", "composer-2.5"],
		offMachine: "Prompts and code go to xAI under your Grok login.",
		binSetting: "grokBin",
	},
	copilot: {
		name: "copilot",
		label: "GitHub Copilot",
		initials: "GC",
		note: "Not fully tested yet. Uses your GitHub login. Model default uses the model Copilot is set to.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine:
			"Prompts and code go to GitHub Copilot under your GitHub login.",
		binSetting: "copilotBin",
	},
	gemini: {
		name: "gemini",
		label: "Gemini CLI",
		initials: "GE",
		note: "Not fully tested yet. Uses your Gemini CLI login. Model default uses the model Gemini CLI is set to.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine: "Prompts and code go to Google under your Gemini CLI login.",
		binSetting: "geminiBin",
	},
	cursor: {
		name: "cursor",
		label: "Cursor",
		initials: "CU",
		note: "Not fully tested yet. Uses your Cursor login: run agent login once.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine: "Prompts and code go to Cursor under your Cursor login.",
		binSetting: "cursorBin",
	},
	pi: {
		name: "pi",
		label: "pi",
		initials: "PI",
		note: "Needs pi 0.81 or later. Model as provider/model, for example ollama/qwen3-coder:latest. Model default uses the model pi is set to.",
		defaultModel: AGENT_DEFAULT,
		suggestedModels: [AGENT_DEFAULT],
		offMachine:
			"Prompts and code go to the model provider pi is set up with. With a local model, such as one in Ollama, they stay on this computer.",
		binSetting: "piBin",
	},
} as const satisfies { [K in HarnessName]: HarnessCatalogEntry & { name: K } };
