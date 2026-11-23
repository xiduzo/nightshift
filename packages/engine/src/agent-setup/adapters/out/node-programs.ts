import { existsSync } from "node:fs";
import { join } from "node:path";
import { putAgentBinsOnPath } from "@nightshift/agents";
import { findProgram } from "@nightshift/agents/types";

import type { Programs } from "../../application/ports";

/**
 * Where a program is on this computer: a search of the PATH, a path as a
 * setting names it, and the vendors' bin folders on PATH after an install.
 */
export function nodePrograms(input: {
	home: string;
	env: Record<string, string | undefined>;
	which?: (program: string) => string | null;
}): Programs {
	const which = input.which ?? findProgram;
	return {
		where: (program) => which(program),
		found: (bin) => {
			if (!bin.includes("/")) return which(bin);
			const path = bin.startsWith("~/") ? join(input.home, bin.slice(2)) : bin;
			return existsSync(path) ? path : null;
		},
		putBinsOnPath: () => putAgentBinsOnPath(input.env, input.home),
		pathInHome: (...parts) => join(input.home, ...parts),
	};
}
