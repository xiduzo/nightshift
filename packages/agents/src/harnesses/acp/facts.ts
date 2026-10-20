import type { HarnessName } from "../../port";
import type { HarnessFacts } from "../harness-record";

/** The harnesses that speak ACP and run through `@tanstack/ai-acp`. */
export type AcpAgentName = Extract<
	HarnessName,
	"copilot" | "gemini" | "cursor" | "pi"
>;

/** The model name that leaves the choice to the agent's own setting. */
export const ACP_DEFAULT_MODEL = "default";

/** The ACP agents in the harness registry, as pure data. */
export const ACP_FACTS: Record<AcpAgentName, HarnessFacts> = {
	copilot: {
		name: "copilot",
		label: "GitHub Copilot",
		initials: "GC",
		pkg: "@tanstack/ai-acp",
		bin: "copilot",
		defaultModel: ACP_DEFAULT_MODEL,
		listing: null,
		note: "Not fully tested yet. Uses your GitHub login. Model default uses the model Copilot is set to.",
		offMachine:
			"Prompts and code go to GitHub Copilot under your GitHub login.",
		takeOver: null,
		skillDirs: [".copilot/skills", ".agents/skills"],
	},
	gemini: {
		name: "gemini",
		label: "Gemini CLI",
		initials: "GE",
		pkg: "@tanstack/ai-acp",
		bin: "gemini",
		defaultModel: ACP_DEFAULT_MODEL,
		listing: null,
		note: "Not fully tested yet. Uses your Gemini CLI login. Model default uses the model Gemini CLI is set to.",
		offMachine: "Prompts and code go to Google under your Gemini CLI login.",
		takeOver: null,
		skillDirs: [".gemini/skills", ".agents/skills"],
	},
	cursor: {
		name: "cursor",
		label: "Cursor",
		initials: "CU",
		pkg: "@tanstack/ai-acp",
		bin: "agent",
		defaultModel: ACP_DEFAULT_MODEL,
		listing: null,
		note: "Not fully tested yet. Uses your Cursor login: run agent login once.",
		offMachine: "Prompts and code go to Cursor under your Cursor login.",
		takeOver: (id) => `agent --resume ${id}`,
		skillDirs: [".cursor/skills", ".agents/skills"],
	},
	pi: {
		name: "pi",
		label: "pi",
		initials: "PI",
		pkg: "@tanstack/ai-acp",
		bin: "pi",
		defaultModel: ACP_DEFAULT_MODEL,
		listing: ["--list-models"],
		note: "Needs pi 0.81 or later. Model as provider/model, for example ollama/qwen3-coder:latest. Model default uses the model pi is set to.",
		offMachine:
			"Prompts and code go to the model provider pi is set up with. With a local model, such as one in Ollama, they stay on this computer.",
		// pi-acp's session id is pi's own: `--session` takes it.
		takeOver: (id) => `pi --session ${id}`,
		skillDirs: [".pi/agent/skills", ".agents/skills"],
	},
};
