import type { HarnessFacts } from "../harness-record";

/** OpenCode in the harness registry, as pure data. */
export const OPENCODE_FACTS: HarnessFacts = {
	name: "opencode",
	label: "OpenCode",
	initials: "OC",
	pkg: "@tanstack/ai-opencode",
	bin: "opencode",
	defaultModel: "anthropic/claude-sonnet-4-5",
	listing: ["models"],
	note: "Model as provider/model. Needs OpenCode 1.x. Version 2.x does not work yet.",
	offMachine:
		"Prompts and code go to the model provider OpenCode is set up with.",
	// From the OpenCode CLI docs (`-s, --session`), not checked against 1.x.
	takeOver: (id) => `opencode --session ${id}`,
	skillDirs: [
		".config/opencode/skills",
		".config/opencode/skill",
		".claude/skills",
		".agents/skills",
	],
};
