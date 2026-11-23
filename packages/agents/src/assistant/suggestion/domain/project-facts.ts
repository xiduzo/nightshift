/** What a command suggestion needs to know of the project before the agent reads. */
export type ProjectFacts = {
	/** From the lock file: `bun`, `pnpm`, `yarn` or `npm`. Null: no lock file. */
	packageManager: string | null;
	/** The scripts of `package.json`, by name. */
	scripts: Record<string, string>;
	/** Other files that name commands: `Makefile`, `justfile`, `Taskfile.yml`. */
	taskFiles: string[];
};
