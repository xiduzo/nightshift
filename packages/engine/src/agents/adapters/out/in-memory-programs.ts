import { join } from "node:path";

import type { Programs } from "../../application/ports";

/** Programs in memory: a map of names, optional paths, and PATH edits. */
export function inMemoryPrograms(
	input: {
		programs?: Record<string, string>;
		home?: string;
		paths?: Record<string, string>;
	} = {},
) {
	const programs = { ...(input.programs ?? {}) };
	const home = input.home ?? "/home/ada";
	const pathPuts: string[] = [];
	const twin = {
		where: (program: string) => programs[program] ?? null,
		found: (bin: string) => {
			if (!bin.includes("/")) return programs[bin] ?? null;
			const path = bin.startsWith("~/") ? join(home, bin.slice(2)) : bin;
			if (input.paths?.[path]) return input.paths[path];
			return Object.values(programs).includes(path) ? path : null;
		},
		putBinsOnPath: () => {
			pathPuts.push(home);
			return pathPuts.length === 1;
		},
		pathInHome: (...parts: string[]) => join(home, ...parts),
		/** Every PATH fix, in order. */
		pathPuts,
		/** Adds a program on this computer. */
		set: (program: string, path: string) => {
			programs[program] = path;
		},
	};
	return twin satisfies Programs;
}
