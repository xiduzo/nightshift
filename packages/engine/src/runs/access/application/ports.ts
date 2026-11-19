import type { Permissions } from "@nightshift/auth";
import type { PersonActor } from "../../../contract";
import type { RunRecord } from "./open-run";

/**
 * The driven ports of access: who may see or act on a run, or act in a
 * Space. Both are its own, each with a real adapter, an in-memory adapter
 * and a contract suite in `adapters/out/`.
 */

/** The runs of this Replica, as access reads them. */
export type RunRecords = {
	/** The run of that id on this Replica, or null. */
	find(runId: string): Promise<RunRecord | null>;
	/** Whether this computer walks the run now. */
	walkedHere(run: Pick<RunRecord, "walkerId">): Promise<boolean>;
};

/** What a Person's role in a Space allows. */
export type SpaceMembers = {
	/**
	 * What the Person's role in the Space allows. The role is read where
	 * the actor's door says: the Members of this Replica for "session" and
	 * "device-key" (and a door that is absent), the Members of the Space
	 * document for "command". `{}` asks only for a Member.
	 */
	may(
		spaceId: string,
		person: PersonActor,
		need: Permissions,
	): Promise<"yes" | "no" | "not-a-member">;
	/**
	 * The Spaces the Person is a Member of on this Replica, and whether
	 * their role in each allows `need`. Read from the Members of this
	 * Replica.
	 */
	spacesOf(
		person: PersonActor,
		need: Permissions,
	): Promise<{ id: string; name: string; allowed: boolean }[]>;
};
