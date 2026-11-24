import type { Programs } from "../../application/ports";

/** The programs of this computer, in memory: a test names the ones it has. */
export function inMemoryPrograms(found: string[] = []) {
	return {
		where: (program: string) =>
			found.includes(program) ? `/usr/bin/${program}` : null,
	} satisfies Programs;
}
