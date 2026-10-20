import type { HarnessFacts } from "../harness-record";

/** Grok Build in the harness registry, as pure data. */
export const GROK_BUILD_FACTS: HarnessFacts = {
	name: "grok-build",
	label: "Grok Build",
	initials: "GB",
	pkg: "@tanstack/ai-grok-build",
	bin: "grok",
	defaultModel: "grok-build",
	listing: null,
	note: "Not fully tested yet. Uses your Grok login: run grok login once.",
	offMachine: "Prompts and code go to xAI under your Grok login.",
	takeOver: (id) => `grok --resume ${id}`,
	skillDirs: [".grok/skills", ".agents/skills"],
};
