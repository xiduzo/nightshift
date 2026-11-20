import type { GitHubAccess, GitHubRepo } from "../../../github";
import type { GitHubClone } from "../domain/clones";
import type { CopySpace } from "../domain/copies";

/**
 * The driven ports of the copies. A port of its own has a real adapter, an
 * in-memory adapter and a contract suite in `adapters/out/`. Another
 * vertical fills a port with `@filledBy`.
 */

/** The clones from GitHub in Night Shift's projects folder, and the GitHub CLI. */
export type GitHubClones = {
	/** The GitHub CLI on this computer: missing, signed out or signed in. */
	access(): Promise<GitHubAccess>;
	/** The person's repositories, when the GitHub CLI is signed in. Else none. */
	repos(): Promise<GitHubRepo[]>;
	/**
	 * Starts a clone of the repository a person entered, or joins the one
	 * that runs. Throws when the input is not a GitHub repository.
	 */
	start(input: string): Promise<GitHubClone>;
	/** The clone of the repository, or null when none started since this daemon did. */
	status(input: string): GitHubClone | null;
	/** Starts or joins the clone of the repository, and waits until it is done or failed. */
	copy(input: string): Promise<GitHubClone>;
};

/** The `origin` of a clone. */
export type CloneOrigins = {
	/**
	 * Makes the clone's `origin` name the repository as the project does.
	 * GitHub names a repository in its own case (`Acme/App`), a person's
	 * clone may not (`acme/app`). False: the clone holds another repository.
	 */
	match(path: string, remote: string): Promise<boolean>;
};

/**
 * The Spaces of this computer, each as Night Shift sees it: the sweep acts
 * for no Person.
 * @filledBy daemon
 */
export type CopySpaces = {
	spaceIds(): Promise<string[]>;
	space(spaceId: string): CopySpace;
	/** Whether the sweep copies: a Host with "Copy every project" on. */
	enabled(): boolean;
};

/**
 * The clock, the GitHub names and the usage of the copies.
 * @filledBy engine/wire
 */
export type CopyGround = {
	now(): number;
	/** Whether a remote is a repository on GitHub. */
	isGitHub(remote: string): boolean;
	/** A copy became a Clone: anonymous usage, when this computer records it. */
	added(): void;
};
