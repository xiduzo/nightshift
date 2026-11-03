import type { DeviceKeyAccess } from "@nightshift/auth";
import type { ConnectionStore } from "@nightshift/engine/device-config";
import { Refusal, wordsFor } from "@nightshift/refusal";
import {
	NOT_A_HOST,
	type SecretMove,
	UNREADABLE_REQUEST,
	type WorkRelay,
	type WorkReply,
	type WorkRequest,
} from "../contract";
import type { DeviceLinks, HostLinks } from "../links";
import type { DeviceRegistry } from "../registry";
import { askHost, PERSONAL_DEADLINE_MS } from "./device";
import { NOT_YOUR_DEVICE } from "./host";

/**
 * Moves of a secret saved on another of the Person's Devices (ADR 13,
 * decision 7): to their Personal secrets, into a Project, or away (it is
 * removed there). Three halves, one per computer:
 *
 * - The Device that asks (`deviceSecretMoves`): the Person's browser asks
 *   this computer. It asks its Home Host over its link, with its own key.
 *   On the Home Host itself, the call goes from its own work hub.
 * - The Home Host (`createSecretMovesHost`): only for a Device of the
 *   key's Person that calls it home, and only to another Device of that
 *   Person that calls it home too. It sends the target a secret call over
 *   that Device's own work stream (`relayMove`). A Device that is offline
 *   is refused at once: nothing waits. A secret on the Home Host computer
 *   itself (its owner's Devices list it too) moves there, for its owner.
 * - The Device that has the value (`serveSecretCall`): it serves a secret
 *   call from its Home Host only, for its own Person only. It reads its
 *   own keychain, saves the value in the new scope through its own Host
 *   calls (where its owner's role is checked again), and removes its copy
 *   only after that save. Its Device document then lists the names
 *   without it, and the copies on the other Devices follow.
 *
 * The value never leaves that Device except to the Host that keeps the
 * new scope. It never passes through the Device that asks.
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
const CANNOT_MOVE = "This device cannot move its secrets.";

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

/**
 * How long a Home Host waits for the Device to move its secret. The
 * Device's own save at its Host may take `PERSONAL_DEADLINE_MS`.
 */
export const MOVE_DEADLINE_MS = PERSONAL_DEADLINE_MS + 25_000;

/** The Device that asks: the browser's move, as this computer passes it on. */
export type SecretMoves = {
	/**
	 * Asks one of the owner's other Devices to move a secret saved there.
	 * Resolves when that Device moved it. Refuses when it is offline, older,
	 * or not one of the owner's.
	 */
	move(deviceId: string, name: string, move: SecretMove): Promise<void>;
};

/** The Home Host's half, as the router serves it. */
export type SecretMovesHost = {
	move(
		key: DeviceKeyAccess,
		input: { deviceId: string; name: string; move: SecretMove },
	): Promise<void>;
};

/** What the Device with the value moves with: its own connection store. */
export type OwnSecrets = Pick<
	ConnectionStore,
	"moveSecret" | "moveToProject" | "removeSecret"
>;

/** How the Home Host reaches the Device with the value. */
type RelayDeps = {
	registry: Pick<DeviceRegistry, "get">;
	/** The Home Host's work hub: the Device takes its calls over its own stream. */
	work: Pick<WorkRelay, "call" | "online">;
	deadlineMs?: number;
};

/**
 * Sends one secret call to another Device of `personId` that calls this
 * Host home, and waits for its answer. Every failure is a refusal in
 * words for people, with the Device's name.
 */
export async function relayMove(
	deps: RelayDeps,
	personId: string,
	input: { deviceId: string; name: string; move: SecretMove },
): Promise<void> {
	const target = await deps.registry.get(input.deviceId);
	if (
		!target ||
		target.revokedAt !== null ||
		target.ownerId !== personId ||
		target.homeHost === null
	) {
		throw new Refusal("not-found", NOT_YOUR_OTHER_DEVICE);
	}
	if (!(await deps.work.online(target.id, ""))) {
		throw new Refusal("unavailable", offlineWords(target.name, input.move));
	}
	const request: WorkRequest = {
		spaceId: "",
		projectId: "",
		personId,
		runId: null,
		call: { kind: "secret", name: input.name, move: input.move },
	};
	const signal = AbortSignal.timeout(deps.deadlineMs ?? MOVE_DEADLINE_MS);
	for await (const reply of deps.work.call(target.id, request, signal)) {
		const refusal = refusalOf(reply, target.name, input.move);
		if (refusal === null) return;
		if (refusal !== undefined) throw refusal;
	}
	throw new Refusal("unavailable", noAnswerWords(target.name));
}

/** A reply as the move ends: null when it moved, a refusal, or undefined to read on. */
function refusalOf(
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

/**
 * This computer as a Home Host, as a paired Device asks it to move a
 * secret on another Device of the same Person. The Device that asks is
 * the key's Person's own, paired here with access, as its Home Host.
 */
export function createSecretMovesHost(
	deps: RelayDeps & {
		/** "Be a Host" is on now. */
		isHost(): boolean;
		/**
		 * This Host as a Device of its owner: its Devices list it among
		 * their owner's other Devices, and it moves its own secrets itself.
		 */
		self: { id: string; ownerId: string; own: OwnSecrets | undefined };
	},
): SecretMovesHost {
	return {
		async move(key, input) {
			if (!deps.isHost()) throw new Refusal("unavailable", NOT_A_HOST);
			const asking = await deps.registry.get(key.deviceId);
			if (
				!asking ||
				asking.revokedAt !== null ||
				asking.ownerId !== key.personId
			) {
				throw new Refusal("forbidden", NOT_YOUR_DEVICE);
			}
			if (asking.homeHost === null) {
				throw new Refusal("forbidden", NOT_HOME_FOR_MOVES);
			}
			const { self } = deps;
			if (input.deviceId !== self.id) {
				return relayMove(deps, key.personId, input);
			}
			// The secret is on this Host: its owner's, moved here.
			if (self.ownerId !== key.personId) {
				throw new Refusal("not-found", NOT_YOUR_OTHER_DEVICE);
			}
			if (!self.own) throw new Refusal("unavailable", CANNOT_MOVE);
			await moveHere(self.own, self.ownerId, input.name, input.move);
		},
	};
}

/**
 * The owner's moves of a secret on another of their Devices, from this
 * computer. A Device that calls this computer home gets the call from
 * this computer's own hub. Any other goes through this computer's Home
 * Host, with this computer's key: the Host checks the rest.
 */
export function deviceSecretMoves(
	deps: RelayDeps & {
		hostLinks: Pick<HostLinks, "home">;
		/** Lazy: the links are made after this. */
		links(): Pick<DeviceLinks, "get">;
		/** The Person who owns this computer: the only one who asks through it. */
		ownerId: string;
	},
): SecretMoves {
	const deadlineMs = deps.deadlineMs ?? MOVE_DEADLINE_MS;
	return {
		async move(deviceId, name, move) {
			const input = { deviceId, name, move };
			const paired = await deps.registry.get(deviceId);
			if (paired?.homeHost && paired.ownerId === deps.ownerId) {
				return relayMove(deps, deps.ownerId, input);
			}
			const home = await deps.hostLinks.home();
			if (!home) throw new Refusal("not-found", NOT_YOUR_OTHER_DEVICE);
			await askHost(
				deps.links().get(home.hostId),
				(client) => client.secrets.moveOnDevice(input),
				// The Host waits for the Device first.
				{ deadlineMs: deadlineMs + 10_000, olderHost: OLDER_HOST_MOVES },
			);
		},
	};
}

/**
 * This computer as the Device with the value: it serves a secret call
 * that came over its link to `via.hostId`. Only its Home Host may ask,
 * and only for this computer's owner as that Host knows them. Never
 * throws: a refusal or a failure is an `error` reply.
 */
export function serveSecretCall(deps: {
	hostLinks: Pick<HostLinks, "home">;
	/** This computer's own secrets. Without them, it moves none. */
	own: OwnSecrets | undefined;
	/** The Person who owns this computer, as this computer knows them. */
	ownerId: string;
}): (
	request: WorkRequest,
	via: { hostId: string },
) => AsyncGenerator<WorkReply> {
	return async function* (request, via) {
		const { call } = request;
		try {
			if (call.kind !== "secret") throw new Refusal("forbidden", CANNOT_MOVE);
			const home = await deps.hostLinks.home();
			if (!home || home.hostId !== via.hostId) {
				throw new Refusal("forbidden", ONLY_FROM_HOME);
			}
			if (request.personId !== home.personId) {
				throw new Refusal("forbidden", ONLY_FOR_OWNER);
			}
			if (!deps.own) throw new Refusal("unavailable", CANNOT_MOVE);
			await moveHere(deps.own, deps.ownerId, call.name, call.move);
			yield { kind: "result", value: null };
		} catch (error) {
			if (!(error instanceof Refusal)) {
				console.error("[secrets] a secret was not moved:", error);
			}
			yield { kind: "error", message: wordsFor(error) };
		}
	};
}

/**
 * Moves a secret saved in this computer's keychain: saved in its new
 * scope first, then this copy goes (the connection store's order). The
 * Device document then lists the names without it.
 */
async function moveHere(
	own: OwnSecrets,
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
