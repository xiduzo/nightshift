import { HARNESS_CATALOG } from "@nightshift/flows";

import type { HarnessFacts } from "../harness-record";

/** Claude Code in the harness registry, as pure data. */
export const CLAUDE_CODE_FACTS: HarnessFacts = {
	...HARNESS_CATALOG["claude-code"],
	pkg: "@tanstack/ai-claude-code",
	bin: "claude",
	// Claude Code has no listing; its aliases (sonnet, opus, haiku) are in the adapter's list.
	listing: null,
	takeOver: (id) => `claude --resume ${id}`,
	skillDirs: [".claude/skills"],
};
