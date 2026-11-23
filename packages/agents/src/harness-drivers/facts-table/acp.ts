import { HARNESS_CATALOG } from "@nightshift/flows";

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
		...HARNESS_CATALOG.copilot,
		pkg: "@tanstack/ai-acp",
		bin: "copilot",
		listing: null,
		takeOver: null,
		skillDirs: [".copilot/skills", ".agents/skills"],
	},
	gemini: {
		...HARNESS_CATALOG.gemini,
		pkg: "@tanstack/ai-acp",
		bin: "gemini",
		listing: null,
		takeOver: null,
		skillDirs: [".gemini/skills", ".agents/skills"],
	},
	cursor: {
		...HARNESS_CATALOG.cursor,
		pkg: "@tanstack/ai-acp",
		bin: "agent",
		listing: null,
		takeOver: (id) => `agent --resume ${id}`,
		skillDirs: [".cursor/skills", ".agents/skills"],
	},
	pi: {
		...HARNESS_CATALOG.pi,
		pkg: "@tanstack/ai-acp",
		bin: "pi",
		listing: ["--list-models"],
		// pi-acp's session id is pi's own: `--session` takes it.
		takeOver: (id) => `pi --session ${id}`,
		skillDirs: [".pi/agent/skills", ".agents/skills"],
	},
};
