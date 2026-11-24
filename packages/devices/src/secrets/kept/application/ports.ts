import type { PersonalSecretName } from "../../../contract";
import type { KeptProjectSecret, Sealed } from "../domain/kept-secret";

/**
 * The driven ports of the kept secrets. Each is a port of its own: the
 * adapters sit in `adapters/out/`. The stores know no access rule: the use cases of
 * `personal`, `projects` and `moves` decide who they serve.
 */

/**
 * How this computer seals a secret at rest (ADR 13, decision 2): bound
 * to whose it is and its name, so a row copied elsewhere does not open.
 */
export type SecretsCipher = {
	/** Encrypts `value`, bound to `bound` (who and which name it is). */
	seal(value: string, bound: string): Promise<Sealed>;
	/** The value, when `bound` is the one it was sealed with and the key is the same. Throws otherwise. */
	open(sealed: Sealed, bound: string): Promise<string>;
};

/**
 * The Personal secrets this computer keeps (ADR 13): for each Person whose
 * Home Host it is, and for its own owner when it has no Home Host. Each
 * value is sealed at rest, bound to its owner and name.
 */
export type PersonalSecretStore = {
	list(ownerId: string): Promise<PersonalSecretName[]>;
	/**
	 * The values of these names that the Person keeps here. A value that
	 * does not open (the secrets key changed) is left out, and logged.
	 */
	values(
		ownerId: string,
		names: readonly string[],
	): Promise<Record<string, string>>;
	/** Saves or replaces a value. `setBy`: the Device that set it. */
	set(
		ownerId: string,
		name: string,
		value: string,
		setBy: string | null,
	): Promise<void>;
	remove(ownerId: string, name: string): Promise<void>;
};

/**
 * The Project secrets this computer keeps (ADR 13): for each Project of
 * a Space it keeps, as its Host or as a computer without one. Each value
 * is sealed at rest, bound to `project:<id>` and its name, so it never
 * opens as another Project's or as a Personal secret.
 */
export type ProjectSecretStore = {
	list(projectId: string): Promise<KeptProjectSecret[]>;
	/**
	 * The values of these names that the Project keeps here, or every one
	 * without `names`. A value that does not open (the secrets key changed)
	 * is left out, and logged.
	 */
	values(
		projectId: string,
		names?: readonly string[],
	): Promise<Record<string, string>>;
	/** Saves or replaces a value. `setBy`: the Person who set it. */
	set(
		project: { spaceId: string; projectId: string },
		name: string,
		value: string,
		setBy: string,
	): Promise<void>;
	remove(projectId: string, name: string): Promise<void>;
};

/**
 * The Space secrets this computer keeps (ADR 18): for each Space it keeps,
 * as its Host or as a computer without one. Each value is sealed at rest,
 * bound to `space:<id>` and its name, so it never opens as another Space's
 * or as a secret of another scope.
 */
export type SpaceSecretStore = {
	list(spaceId: string): Promise<KeptProjectSecret[]>;
	/** The values of these names, or every one without `names`. One that does not open is left out, and logged. */
	values(
		spaceId: string,
		names?: readonly string[],
	): Promise<Record<string, string>>;
	set(
		spaceId: string,
		name: string,
		value: string,
		setBy: string,
	): Promise<void>;
	remove(spaceId: string, name: string): Promise<void>;
};
