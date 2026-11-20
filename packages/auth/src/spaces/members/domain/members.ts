/**
 * Members of a Space and how people join a Host.
 *
 * A Host is invitation-only. The first Person on it is the Host admin
 * (the admin plugin's `admin` role). After that, an email and password
 * account is made only with a pending invitation of that email, and the
 * sign-up names the invitation (`invitationId`). So an invitation is also
 * the account. Accepting it makes the Person a Member of its Space.
 *
 * There is no email server: the Members page shows the invitation link to
 * copy. A sender can hook into the organization plugin's
 * `sendInvitationEmail` later.
 */

/** The admin plugin's role of the Host admin. */
export const HOST_ADMIN = "admin";

/** A sign-up without an invitation, on a Host that has a Person. */
export const INVITATION_ONLY =
	"New people join by invitation only. Open the invitation link you got.";

/** A sign-up whose invitation is not pending for its email. */
export const INVITATION_NOT_VALID =
	"This invitation is not valid for this email. Ask for a new invitation.";

/** A change of a Space's Members, with the Person who made it. */
export type MemberChange =
	| {
			kind: "joined";
			spaceId: string;
			personId: string;
			role: string;
			/** Who added them: themselves for an accepted invitation or a new Space. Null: unknown. */
			by: string | null;
			/** The Person who sent the invitation they accepted. */
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

/** The status of an invitation: `expired` is pending, but past its time. */
export type InvitationStatus =
	| "pending"
	| "accepted"
	| "canceled"
	| "rejected"
	| "expired";

/**
 * The status the page shows: a pending invitation past its time is
 * `expired` at `now`.
 */
export function invitationStatus(
	invitation: { status: string; expiresAt: number },
	now: number,
): InvitationStatus {
	return invitation.status === "pending" && invitation.expiresAt <= now
		? "expired"
		: (invitation.status as InvitationStatus);
}
