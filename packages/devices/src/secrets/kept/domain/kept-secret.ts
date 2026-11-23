/**
 * The secrets this computer keeps (ADR 13, ADR 18), as the stores give
 * them, and what each value is bound to when it is sealed at rest.
 */

/** A value as it is kept: both in base64. */
export type Sealed = { ciphertext: string; iv: string };

/** A Project or Space secret as this computer keeps it: its name, when it was set and by whom. */
export type KeptProjectSecret = {
	name: string;
	setAt: number;
	/** The Person who set it last. Null: not known. */
	setBy: string | null;
};

/** The shortest secrets key this computer takes, in characters. */
export const SECRETS_KEY_MIN = 32;

/** What a Personal value is bound to: whose it is, and its name. */
export const personalBound = (ownerId: string, name: string): string =>
	`${ownerId}\n${name}`;

/** What a Project value is bound to: its Project, and its name. */
export const projectBound = (projectId: string, name: string): string =>
	`project:${projectId}\n${name}`;

/** What a Space value is bound to: its Space, and its name. */
export const spaceBound = (spaceId: string, name: string): string =>
	`space:${spaceId}\n${name}`;
