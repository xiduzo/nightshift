/** The door a Person's request came through. It says where their role in a Space is read. */
export type Door = "session" | "device-key" | "command";

/**
 * A Person who acts, and the door their request came through. With
 * "session" (the API) and "device-key" (the Host), the role is read from
 * the Members of this Replica. With "command", the Walker reads it from
 * the Members of the Space document.
 */
export type PersonActor = { personId: string; door: Door };

/** Night Shift itself: a schedule, a webhook, recovery, the notifier, a reader in this process. No role applies. */
export type NightShiftActor = { nightShift: true };

/** Who acts: a Person, or Night Shift itself. */
export type Actor = PersonActor | NightShiftActor;

/** Night Shift as the actor. */
export const NIGHT_SHIFT: NightShiftActor = { nightShift: true };

/** The Person of an actor, or null for Night Shift. */
export function personOf(actor: Actor): string | null {
	return "personId" in actor ? actor.personId : null;
}

/** A change of a Space's Members, as the auth hooks report it. */
export type MemberChange =
	| {
			kind: "joined";
			spaceId: string;
			personId: string;
			role: string;
			by: string | null;
			invitedBy?: string;
	  }
	| { kind: "removed"; spaceId: string; personId: string; by: string | null }
	| {
			kind: "role";
			spaceId: string;
			personId: string;
			role: string;
			previousRole: string;
			by: string | null;
	  };
