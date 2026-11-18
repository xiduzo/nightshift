import { HARNESS_CATALOG } from "@nightshift/flows";

import type { HarnessFacts } from "../harness-record";

/** Grok Build in the harness registry, as pure data. */
export const GROK_BUILD_FACTS: HarnessFacts = {
	...HARNESS_CATALOG["grok-build"],
	pkg: "@tanstack/ai-grok-build",
	bin: "grok",
	listing: null,
	takeOver: (id) => `grok --resume ${id}`,
	skillDirs: [".grok/skills", ".agents/skills"],
};
