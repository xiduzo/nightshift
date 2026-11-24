import { RoleRefusal } from "@nightshift/auth";
import { type Actor, NIGHT_SHIFT, type PersonActor } from "../../../contract";
import { openRun } from "../../application/open-run";
import { openSpace } from "../../application/open-space";
import { RunNotFound, SpaceNotFound } from "../../domain/refusals";
import { inMemoryRunRecords } from "./in-memory-run-records";
import { inMemorySpaceMembers } from "./in-memory-space-members";

/** The roles a Space has by default. */
type SpaceRole = "owner" | "admin" | "member" | "viewer";

/** What access answered an actor. */
type AccessAnswer = "yes" | "no" | "not-found" | "too-late";

/**
 * Access over in-memory adapters: the real `openRun` and `openSpace`, with
 * the runs and the Members a test puts in. The use-case test of every slice
 * that asks who may act takes this one. Nobody is a Member until the test
 * says so (`as`, `members.join`).
 */
export function inMemoryAccess(walkerId?: string) {
	const ports = {
		runs: inMemoryRunRecords(walkerId),
		members: inMemorySpaceMembers(),
		RoleRefusal,
	};
	const twin = {
		...ports,
		openRun: openRun(ports),
		openSpace: openSpace(ports),

		/** A Person with `role` in the Space. */
		as(role: SpaceRole, spaceId: string): PersonActor {
			const personId = `the-${role}`;
			ports.members.join(spaceId, personId, role);
			return { personId, door: "session" };
		},

		/**
		 * Who may act in the Space: asks `act` as a Person of another Space,
		 * as each role, and as Night Shift. A refusal that is not one of access
		 * says that the actor got in. `effects` reads what `act` may change: a
		 * refused ask that changed it was refused too late.
		 */
		async whoMay(
			spaceId: string,
			act: (actor: Actor) => Promise<unknown>,
			effects: () => unknown = () => null,
		) {
			const ask = async (actor: Actor): Promise<AccessAnswer> => {
				const before = JSON.stringify(effects());
				const refused = (answer: AccessAnswer): AccessAnswer =>
					JSON.stringify(effects()) === before ? answer : "too-late";
				try {
					await act(actor);
				} catch (error) {
					if (error instanceof RoleRefusal) return refused("no");
					if (error instanceof SpaceNotFound || error instanceof RunNotFound) {
						return refused("not-found");
					}
				}
				return "yes";
			};
			const stranger: PersonActor = { personId: "a-stranger", door: "session" };
			return {
				stranger: await ask(stranger),
				viewer: await ask(twin.as("viewer", spaceId)),
				member: await ask(twin.as("member", spaceId)),
				admin: await ask(twin.as("admin", spaceId)),
				owner: await ask(twin.as("owner", spaceId)),
				nightShift: await ask(NIGHT_SHIFT),
			};
		},
	};
	return twin;
}

export type InMemoryAccess = ReturnType<typeof inMemoryAccess>;

/** What `whoMay` gives when only the Members with those roles may act. */
export function allowing(
	...roles: readonly SpaceRole[]
): Awaited<ReturnType<InMemoryAccess["whoMay"]>> {
	const answer = (role: SpaceRole) => (roles.includes(role) ? "yes" : "no");
	return {
		stranger: "not-found",
		viewer: answer("viewer"),
		member: answer("member"),
		admin: answer("admin"),
		owner: answer("owner"),
		nightShift: "yes",
	};
}
