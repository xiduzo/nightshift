import type { ProjectRef, StepRun } from "../../../contract";
import type { ProjectSecretName } from "../domain/secret-views";

/**
 * The driven ports of secrets. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireSecrets`.
 *
 * Values never reach the database, the document, the log or a reply: the
 * document holds the names of this computer's saved secrets only, with
 * when each was last set and last used. A Personal or Project value is
 * read for one use and kept in memory for that use only.
 */

/**
 * Where the values of this computer's saved secrets live: the system
 * keychain, or files on a headless computer (`secretStore`).
 * @filledBy engine/key-store
 */
export type ComputerSecrets = {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
};

/**
 * The facts of this computer's secrets in its Device document: the saved
 * names with when each was set (the keychain cannot list them), and when
 * each name was last used. Names and times, never values. A read is
 * synchronous: it parses again only after the document changed.
 */
export type SecretFacts = {
	/** Each saved name, with when it was set. An entry that does not parse is left out. */
	saved(): ReadonlyMap<string, number | null>;
	/** When each name was last used: any name, saved or from the environment. */
	usedAt(): ReadonlyMap<string, number>;
	/**
	 * Writes the saved names, sorted, in one change of the document. The
	 * use times of `forget` go in the same change.
	 */
	writeSaved(
		saved: ReadonlyMap<string, number | null>,
		forget?: readonly string[],
	): Promise<void>;
	/** Writes the use times, in one change of the document. */
	writeUsed(used: ReadonlyMap<string, number>): Promise<void>;
	/** Calls `listener` after the saved names change, here or synced. Returns the unsubscribe. */
	onSavedChange(listener: () => void): () => void;
};

/**
 * The connections that reference each `${NAME}`: the Secrets page lists
 * them, and a session's output takes out their values.
 * @filledBy engine/settings
 */
export type SecretReferences = {
	/** Each referenced name with the connections that reference it, in the order of the connections. */
	usedBy(): ReadonlyMap<string, readonly string[]>;
};

/**
 * The Person's Personal secrets, as this computer reaches them: its Home
 * Host keeps them, or this computer when it has none. Names with when
 * each was set, and values only for a use. Each call throws when they
 * cannot be reached now.
 * @filledBy devices
 */
export type PersonalSecrets = {
	list(): Promise<{ name: string; setAt: number }[]>;
	/** The values of these names that are Personal secrets. A name that is none is left out. */
	values(names: readonly string[]): Promise<Record<string, string>>;
	set(name: string, value: string): Promise<void>;
	remove(name: string): Promise<void>;
};

/**
 * The secrets of the Projects as this computer reaches them: the Host
 * that keeps the Project's Space keeps them, or this computer when it
 * keeps the Space itself. Each call throws when they cannot be reached
 * now, or when the keeper refuses.
 *
 * `personId` is the Person who acts here. The keeper lists the names to
 * a Member of the Space, and makes a change for a Member whose role
 * saves Flows.
 * @filledBy devices
 */
export type ProjectSecrets = {
	list(project: ProjectRef, personId: string): Promise<ProjectSecretName[]>;
	/**
	 * The values of these names that are secrets of the run's Project or
	 * its Space, for one step of it. The Space's wins (ADR 18). Every value
	 * without `names` (to take them out of the step's output). A name that
	 * is none is left out.
	 */
	values(
		run: StepRun,
		names?: readonly string[],
	): Promise<Record<string, string>>;
	set(
		project: ProjectRef,
		name: string,
		value: string,
		personId: string,
	): Promise<void>;
	remove(project: ProjectRef, name: string, personId: string): Promise<void>;
	/**
	 * The value of a name, read to move it to another scope (ADR 13,
	 * decision 7): it is never shown. Null when the Project has none.
	 */
	take(
		project: ProjectRef,
		name: string,
		personId: string,
	): Promise<string | null>;
	/**
	 * The values of the Project and its Space that this computer keeps
	 * itself, the Space's first: all of them, or those of `names`. For an
	 * exported run, to take them out, and for a webhook, which no step asks
	 * for. Empty when another Host keeps them.
	 */
	kept(project: ProjectRef, names?: readonly string[]): Promise<string[]>;
	/** The secrets of a Space (ADR 18): every step of a run in the Space reads them through `values`. */
	space: SpaceSecrets;
};

/**
 * A Space's secrets, for the screens. Same rules as a Project's, for the
 * whole Space.
 * @filledBy devices
 */
export type SpaceSecrets = {
	list(spaceId: string, personId: string): Promise<ProjectSecretName[]>;
	set(
		spaceId: string,
		name: string,
		value: string,
		personId: string,
	): Promise<void>;
	remove(spaceId: string, name: string, personId: string): Promise<void>;
	/** The value of a name, read to move it to another scope: it is never shown. */
	take(spaceId: string, name: string, personId: string): Promise<string | null>;
};
