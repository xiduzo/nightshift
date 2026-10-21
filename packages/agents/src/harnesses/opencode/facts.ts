import { HARNESS_CATALOG } from "@nightshift/flows";

import type { HarnessFacts } from "../harness-record";

/** OpenCode in the harness registry, as pure data. */
export const OPENCODE_FACTS: HarnessFacts = {
	...HARNESS_CATALOG.opencode,
	pkg: "@tanstack/ai-opencode",
	bin: "opencode",
	listing: ["models"],
	// From the OpenCode CLI docs (`-s, --session`), not checked against 1.x.
	takeOver: (id) => `opencode --session ${id}`,
	skillDirs: [
		".config/opencode/skills",
		".config/opencode/skill",
		".claude/skills",
		".agents/skills",
	],
};
