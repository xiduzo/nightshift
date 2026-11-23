import { Refusal } from "@nightshift/refusal";
import type { SecretMove, WorkRequest } from "../../../contract";
import {
	NOT_YOUR_OTHER_DEVICE,
	noAnswerWords,
	offlineWords,
	refusalOf,
} from "../domain/secret-moves";
import type { MoveWork, OtherDevices } from "./ports";

export type RelaySecretMovePorts = {
	devices: OtherDevices;
	work: MoveWork;
	/** How long the Home Host waits for the Device to move its secret. */
	deadlineMs: number;
};

/** The Person, their other Device, and the move of a secret saved there. */
export type RelaySecretMove = {
	personId: string;
	deviceId: string;
	name: string;
	move: SecretMove;
};

/**
 * Sends one secret call to another Device of the Person that calls this
 * Host home, and waits for its answer. A Device that is offline is
 * refused at once: nothing waits. Every failure is a refusal in words
 * for people, with the Device's name.
 *
 * The Home Host asks, for a Person it checked: the use case takes the request alone.
 */
export const relaySecretMove =
	(ports: RelaySecretMovePorts) =>
	async (relayed: RelaySecretMove): Promise<void> => {
		const { personId, ...input } = relayed;
		const target = await ports.devices.get(input.deviceId);
		if (
			!target ||
			target.revokedAt !== null ||
			target.ownerId !== personId ||
			target.homeHost === null
		) {
			throw new Refusal("not-found", NOT_YOUR_OTHER_DEVICE);
		}
		if (!(await ports.work.online(target.id, ""))) {
			throw new Refusal("unavailable", offlineWords(target.name, input.move));
		}
		const request: WorkRequest = {
			spaceId: "",
			projectId: "",
			personId,
			runId: null,
			call: { kind: "secret", name: input.name, move: input.move },
		};
		const signal = AbortSignal.timeout(ports.deadlineMs);
		for await (const reply of ports.work.call(target.id, request, signal)) {
			const refusal = refusalOf(reply, target.name, input.move);
			if (refusal === null) return;
			if (refusal !== undefined) throw refusal;
		}
		throw new Refusal("unavailable", noAnswerWords(target.name));
	};
