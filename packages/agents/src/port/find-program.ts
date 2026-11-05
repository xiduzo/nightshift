/**
 * Where a program is on this computer, or null. Reads PATH as it is now:
 * plain `Bun.which(name)` keeps the PATH the process started with, and the
 * desktop app sets its PATH after it starts (a start from Finder has a
 * short one). Use this, never plain `Bun.which(name)`.
 */
export function findProgram(name: string): string | null {
	return Bun.which(name, { PATH: process.env.PATH ?? "" });
}
