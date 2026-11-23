import type { ProgramHelp } from "../../application/ports";

/** The help of each program, in memory: what a test sets, and the programs it was asked for. */
export function inMemoryProgramHelp(helps: Record<string, string> = {}) {
	const asked: string[] = [];
	const twin = {
		async help(program: string) {
			asked.push(program);
			return helps[program] ?? null;
		},
		asked,
	};
	return twin satisfies ProgramHelp;
}
