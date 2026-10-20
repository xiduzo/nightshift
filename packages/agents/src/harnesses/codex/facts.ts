import type { HarnessFacts } from "../harness-record";

/** Codex in the harness registry, as pure data. */
export const CODEX_FACTS: HarnessFacts = {
	name: "codex",
	label: "Codex",
	initials: "CX",
	pkg: "@tanstack/ai-codex",
	bin: "codex",
	defaultModel: "gpt-5.3-codex",
	listing: null,
	note: "Not fully tested yet. Uses your Codex login.",
	offMachine: "Prompts and code go to OpenAI under your Codex login.",
	takeOver: (id) => `codex resume ${id}`,
	skillDirs: [".codex/skills", ".agents/skills"],
};
