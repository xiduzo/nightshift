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
	limitsTurns: true,
	// https://code.claude.com/docs/en/setup: the native installer asks
	// nothing, refuses sudo and puts `claude` in ~/.local/bin.
	// `claude auth login` opens the browser; the person may paste a code.
	setup: {
		vendor: "Anthropic",
		installScript: "https://claude.ai/install.sh",
		installShell: "bash",
		installEnv: {},
		binDir: ".local/bin",
		signIn: ["auth", "login"],
		signInHosts: ["claude.ai", "claude.com", "anthropic.com"],
		signInIo: "pipes",
	},
};
