import type { PersonActor } from "@nightshift/engine";
import { type PushTargetView, targetView } from "../domain/push-targets";
import type { Sessions, TargetStore } from "./ports";

export type RemoveScreenPorts = {
	targetStore: Pick<TargetStore, "remove">;
	sessions: Pick<Sessions, "end">;
};

/** The id of one of the Person's screens. */
export type RemoveScreen = { id: string };

/**
 * Removes a screen of the Person who asks: it gets no more notifications. A
 * phone is a push target plus its session, so removing it signs it out.
 * Null when the Person has no target of that id: the door says what that
 * means. No role applies, and nobody removes another's.
 */
export const removeScreen =
	(ports: RemoveScreenPorts) =>
	async (
		actor: PersonActor,
		request: RemoveScreen,
	): Promise<PushTargetView | null> => {
		const removed = await ports.targetStore.remove(actor.personId, request.id);
		if (!removed) return null;
		if (removed.kind === "expo" && removed.sessionId) {
			await ports.sessions.end(actor.personId, removed.sessionId);
		}
		return targetView(removed);
	};
