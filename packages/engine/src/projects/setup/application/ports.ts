import type { GitInstall } from "../../../git";

/**
 * The driven ports of the setup of a project folder. A port of its own has
 * a real adapter, an in-memory adapter and a contract suite in
 * `adapters/out/`. Another vertical fills a port with `@filledBy`.
 */

/** The folders and git repositories of this computer. */
export type ProjectFolders = {
	/** Whether git runs on this computer. */
	gitInstalled(): Promise<boolean>;
	/** Whether `path` is a folder. */
	isDirectory(path: string): Promise<boolean>;
	/** The folder without links. */
	realpath(path: string): Promise<string>;
	/** The repository's top folder, or null when `dir` is not in a repository. */
	topLevel(dir: string): Promise<string | null>;
	/** Whether the repository at `dir` has a commit. */
	hasCommit(dir: string): Promise<boolean>;
	/** Whether git has a name and an email for `dir`. */
	hasIdentity(dir: string): Promise<boolean>;
	/** Makes `dir` a repository. */
	init(dir: string): Promise<void>;
	/** Sets a name or an email in the repository's own config. */
	setIdentity(
		dir: string,
		key: "user.name" | "user.email",
		value: string,
	): Promise<void>;
	/** Whether `dir` has a `.gitignore`. */
	hasGitignore(dir: string): Promise<boolean>;
	/** Writes the `.gitignore` of `dir`. */
	writeGitignore(dir: string, text: string): Promise<void>;
	/** Commits every file of `dir`, also when there is none. */
	commitAll(dir: string, message: string): Promise<void>;
};

/**
 * The programs of this computer, and its system.
 * @filledBy engine/wire
 */
export type Programs = {
	which(name: string): string | null;
	platform: string;
};

/**
 * The git installer of this computer.
 * @filledBy engine/git
 */
export type GitInstaller = {
	install(): Promise<GitInstall>;
};
