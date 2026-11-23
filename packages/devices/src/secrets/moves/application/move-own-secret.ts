import { Refusal, wordsFor } from "@nightshift/refusal";
import type { WorkReply, WorkRequest } from "../../../contract";
import type { HostCalls } from "../../calls";
import {
	CANNOT_MOVE,
	moveHere,
	ONLY_FOR_OWNER,
	ONLY_FROM_HOME,
} from "../domain/secret-moves";
import type { OwnSecrets } from "./ports";

export type MoveOwnSecretPorts = {
	calls: Pick<HostCalls, "home">;
	/** This computer's own secrets. Without them, it moves none. */
	own: OwnSecrets | undefined;
	/** The Person who owns this computer, as this computer knows them. */
	ownerId: string;
};

/** A secret call, and the Host whose link it came over. */
export type MoveOwnSecret = { request: WorkRequest; hostId: string };

/**
 * This computer as the Device with the value: it serves a secret call
 * that came over its link to a Host. Only its Home Host may ask, and only
 * for this computer's owner as that Host knows them. It saves the value
 * in the new scope first, then removes its copy. Never throws: a refusal
 * or a failure is an `error` reply.
 *
 * Its Home Host asks over the link: the use case takes the request alone.
 */
export const moveOwnSecret = (ports: MoveOwnSecretPorts) =>
	async function* (served: MoveOwnSecret): AsyncGenerator<WorkReply> {
		const { request } = served;
		const { call } = request;
		try {
			if (call.kind !== "secret") throw new Refusal("forbidden", CANNOT_MOVE);
			const home = await ports.calls.home();
			if (!home || home.hostId !== served.hostId) {
				throw new Refusal("forbidden", ONLY_FROM_HOME);
			}
			if (request.personId !== home.personId) {
				throw new Refusal("forbidden", ONLY_FOR_OWNER);
			}
			if (!ports.own) throw new Refusal("unavailable", CANNOT_MOVE);
			await moveHere(ports.own, ports.ownerId, call.name, call.move);
			yield { kind: "result", value: null };
		} catch (error) {
			if (!(error instanceof Refusal)) {
				console.error("[secrets] a secret was not moved:", error);
			}
			yield { kind: "error", message: wordsFor(error) };
		}
	};
