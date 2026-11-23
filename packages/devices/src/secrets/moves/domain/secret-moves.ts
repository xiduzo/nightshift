import { Refusal } from "@nightshift/refusal";
import {
	type SecretMove,
	UNREADABLE_REQUEST,
	type WorkReply,
} from "../../../contract";

/**
 * The rules and the words of the moves of a secret saved on another of
 * the Person's Devices (ADR 13, decision 7).
 */

/** What a person reads when their Home Host cannot move secrets between devices yet. */
export const OLDER_HOST_MOVES =
	"Your home Host runs an older version of Night Shift. Update Night Shift there to move secrets between your devices.";

/** The refusal of a Device that is not another of the Person's own here. */
export const NOT_YOUR_OTHER_DEVICE =
	"Night Shift does not know that device as one of yours.";

/** The refusal of a Device that asks a Host that is not its Home Host. */
export const NOT_HOME_FOR_MOVES =
	"Only your home Host moves secrets between your devices.";

/** The refusal of a secret call that does not come from this computer's Home Host. */
export const ONLY_FROM_HOME =
	"This device moves its secrets only when its home Host asks.";

/** The refusal of a secret call for another Person than this computer's owner. */
export const ONLY_FOR_OWNER =
	"Only the owner of this device can move its secrets.";

/** The refusal of a secret call on a computer that cannot move its secrets. */
export const CANNOT_MOVE = "This device cannot move its secrets.";

/** The verb of a move, for the words a person reads. */
const verbOf = (move: SecretMove) =>
	move.to === "removed" ? "Remove" : "Move";

/** What a person reads when the Device with the value is offline. */
export function offlineWords(device: string, move: SecretMove): string {
	return `${device} is offline. ${verbOf(move)} it when ${device} is online.`;
}

/** What a person reads when the Device with the value runs an older version. */
export function olderDeviceWords(device: string): string {
	return `Update Night Shift on ${device} to move its secrets from here.`;
}

/** What a person reads when the Device took the call and did not answer in time. */
export function noAnswerWords(device: string): string {
	return `${device} did not answer. Check that ${device} is online, then try again.`;
}

/** A reply as the move ends: null when it moved, a refusal, or undefined to read on. */
export function refusalOf(
	reply: WorkReply,
	device: string,
	move: SecretMove,
): Refusal | null | undefined {
	if (reply.kind === "result") return null;
	if (reply.kind !== "error") return undefined;
	if (reply.offline) {
		return new Refusal("unavailable", offlineWords(device, move));
	}
	if (reply.message === UNREADABLE_REQUEST) {
		return new Refusal("unavailable", olderDeviceWords(device));
	}
	return new Refusal("conflict", reply.message);
}

/** The moves a computer makes of a secret in its own keychain (its connection store's). */
export type OwnMoves = {
	moveSecret(name: string, to: "personal"): Promise<void>;
	moveToProject(
		name: string,
		from: "computer",
		project: { spaceId: string; projectId: string },
		personId: string,
	): Promise<void>;
	removeSecret(name: string, scope: "computer"): Promise<void>;
};

/**
 * Moves a secret saved in this computer's keychain: saved in its new
 * scope first, then this copy goes (the connection store's order). The
 * Device document then lists the names without it.
 */
export async function moveHere(
	own: OwnMoves,
	ownerId: string,
	name: string,
	move: SecretMove,
): Promise<void> {
	switch (move.to) {
		case "personal":
			return own.moveSecret(name, "personal");
		case "project":
			return own.moveToProject(
				name,
				"computer",
				{ spaceId: move.spaceId, projectId: move.projectId },
				ownerId,
			);
		case "removed":
			return own.removeSecret(name, "computer");
	}
}
