import type { Actor } from "@nightshift/engine";
import { type PushTargetView, targetView } from "../domain/push-targets";
import type { Sessions, TargetStore } from "./ports";

export type RemoveScreenPorts = {
	targetStore: Pick<TargetStore, "remove">;
	sessions: Pick<Sessions, "end">;
};

/** The Person, and the id of one of their screens. */
export type RemoveScreen = { personId: string; id: string };

/**
 * Removes one of the Person's screens: it gets no more notifications. A
 * phone is a push target plus its session, so removing it signs it out.
 * Null when the Person has no target of that id: the door says what that
 * means. Who asks: the Person, for their own. No role applies.
 */
export const removeScreen =
	(ports: RemoveScreenPorts) =>
	async (
		_actor: Actor,
		request: RemoveScreen,
	): Promise<PushTargetView | null> => {
		const removed = await ports.targetStore.remove(
			request.personId,
			request.id,
		);
		if (!removed) return null;
		if (removed.kind === "expo" && removed.sessionId) {
			await ports.sessions.end(request.personId, removed.sessionId);
		}
		return targetView(removed);
	};
