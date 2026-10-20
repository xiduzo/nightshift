import type { HarnessFacts } from "../harness-record";

/** Claude Code in the harness registry, as pure data. */
export const CLAUDE_CODE_FACTS: HarnessFacts = {
	name: "claude-code",
	label: "Claude Code",
	initials: "CC",
	pkg: "@tanstack/ai-claude-code",
	bin: "claude",
	defaultModel: "sonnet",
	// Claude Code has no listing; its aliases (sonnet, opus, haiku) are in the adapter's list.
	listing: null,
	note: "Uses your Claude login. Model: an alias such as sonnet, or a full model id.",
	offMachine:
		"Prompts and your project's code go to Anthropic under your Claude login.",
	takeOver: (id) => `claude --resume ${id}`,
	skillDirs: [".claude/skills"],
};
