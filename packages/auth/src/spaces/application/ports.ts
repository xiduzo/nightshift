import type { Role } from "../roles";
import type { Space } from "./list-spaces";

/**
 * The driven ports of spaces. A port of its own has a real adapter, an
 * in-memory adapter and a contract suite in `adapters/out/`.
 */

/** The Spaces of this Replica and the roles of their Members. */
export type SpaceStore = {
	/**
	 * The Spaces the Person is a member of, the personal one first, then by
	 * name. A membership of a Space that is gone does not count.
	 */
	spacesOf(personId: string): Promise<Space[]>;
	/**
	 * The Person's role in the Space, from their membership alone: a
	 * membership of a Space that is gone counts here (decision 87).
	 */
	roleOf(personId: string, spaceId: string): Promise<Role | null>;
	/** Whether a Space of that id exists. */
	exists(spaceId: string): Promise<boolean>;
	/** The id of every Space. */
	ids(): Promise<string[]>;
	/** Makes the row of a Host's Space (slug `host-<id>`), or gives the row the Host's name. */
	mirror(space: { id: string; name: string }): Promise<void>;
};
