import { roleAllows, wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import type { MemberSpaces } from "../../application/ports";

/** What the Spaces of a Person stand on: this Replica's database, its `member` rows. */
export type AuthMemberSpacesDeps = { db: Database };

/**
 * The Spaces of a Person over `@nightshift/auth`: the `member` rows of this
 * Replica, each with its Space's name and the role read with it, in one
 * statement for every Space. Whether the role allows `need` is auth's
 * rule (`roleAllows`). `{}` asks for a Member only.
 */
export function authMemberSpaces(deps: AuthMemberSpacesDeps): MemberSpaces {
	const spaces = wireSpaces({ db: deps.db });
	return {
		async of(person, need) {
			const listed = await spaces.listSpaces({ personId: person.personId });
			return listed.map((space) => ({
				id: space.id,
				name: space.name,
				allowed: Object.keys(need).length === 0 || roleAllows(space.role, need),
			}));
		},
	};
}
