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
};
