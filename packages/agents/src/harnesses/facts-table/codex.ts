import { HARNESS_CATALOG } from "@nightshift/flows";

import type { HarnessFacts } from "../harness-record";

/** Codex in the harness registry, as pure data. */
export const CODEX_FACTS: HarnessFacts = {
	...HARNESS_CATALOG.codex,
	pkg: "@tanstack/ai-codex",
	bin: "codex",
	listing: null,
	takeOver: (id) => `codex resume ${id}`,
	skillDirs: [".codex/skills", ".agents/skills"],
	// https://developers.openai.com/codex: the installer uses no sudo and
	// puts `codex` in ~/.local/bin. It asks two questions unless
	// CODEX_NON_INTERACTIVE is set. `codex login` waits for the browser.
	setup: {
		vendor: "OpenAI",
		installScript: "https://chatgpt.com/codex/install.sh",
		installShell: "sh",
		installEnv: { CODEX_NON_INTERACTIVE: "1" },
		binDir: ".local/bin",
		signIn: ["login"],
		signInHosts: ["openai.com", "chatgpt.com"],
		signInIo: "pipes",
	},
};
