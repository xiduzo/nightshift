import {
	type Permissions,
	roleAllows,
	roleIn,
	spacesOf,
} from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { SpaceMembers } from "../../application/ports";

export type AuthSpaceMembersDeps = {
	/** This Replica's database: its `member` rows. */
	db: Database;
	/**
	 * The Person's role as the Members of the Space document name it, or
	 * null: what the Walker reads for a Command (`memberRole` of `projects`).
	 */
	documentRole(spaceId: string, personId: string): Promise<string | null>;
};

/**
 * Whether a role allows `need`, as `@nightshift/auth` decides it
 * (`roleAllows`). `{}` asks for a Member only, so any role of a Member
 * allows it, also one this version does not know.
 */
function allows(role: string, need: Permissions): boolean {
	return Object.keys(need).length === 0 || roleAllows(role, need);
}

/**
 * What a Person's role allows, over the roles of `@nightshift/auth`. The
 * API and a Host read the `member` rows of this Replica (`roleIn`). The
 * Walker reads a Command's Person from the Members of the Space document,
 * as the exchange of `devices` did before (`door: "command"`).
 */
export function authSpaceMembers(deps: AuthSpaceMembersDeps): SpaceMembers {
	return {
		async may(spaceId, person, need) {
			const role =
				person.door === "command"
					? await deps.documentRole(spaceId, person.personId)
					: await roleIn(deps.db, person.personId, spaceId);
			if (!role) return "not-a-member";
			return allows(role, need) ? "yes" : "no";
		},
		async spacesOf(person, need) {
			const spaces = await spacesOf(deps.db, person.personId);
			return spaces.map((space) => ({
				id: space.id,
				name: space.name,
				allowed: allows(space.role, need),
			}));
		},
	};
}
