/**
 * Where a program is on this computer: the search of the PATH.
 * @filledBy agents
 */
export type Programs = {
	/** The path of the program, or null when this computer does not have it. */
	where(program: string): string | null;
};
