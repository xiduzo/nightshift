import {
	type PushTargetView,
	registerTargetSchema,
	type RegisterTarget as TargetInput,
	targetView,
} from "../domain/push-targets";
import type { TargetStore } from "./ports";

export type RegisterTargetPorts = {
	targetStore: Pick<TargetStore, "dropPhoneOfOthers" | "upsert">;
	clock: () => number;
	/** The id of a new target. */
	newId: () => string;
};

/** The Person, the screen, and the session that registers it (null: none). */
export type RegisterTarget = {
	personId: string;
	screen: TargetInput;
	sessionId: string | null;
};

/**
 * Registers a screen for the Person: a browser, a phone, or this
 * computer's desktop app. When the Person has its endpoint already, it
 * gets the new name and keys and is marked seen. A phone holds one
 * Person's session at a time: its push token stops reaching any other
 * Person who signed in on it before. Night Shift asks, for the desktop of
 * this computer's owner. A Person registers their own through
 * `registerScreen`.
 */
export const registerTarget =
	(ports: RegisterTargetPorts) =>
	async (request: RegisterTarget): Promise<PushTargetView> => {
		const { personId, sessionId } = request;
		const screen = registerTargetSchema.parse(request.screen);
		const at = ports.clock();
		if (screen.kind === "expo") {
			await ports.targetStore.dropPhoneOfOthers(personId, screen.endpoint);
		}
		const kept = await ports.targetStore.upsert({
			id: ports.newId(),
			personId,
			kind: screen.kind,
			name: screen.name,
			platform: screen.platform,
			endpoint: screen.endpoint,
			keys: screen.keys,
			sessionId,
			at,
		});
		if (!kept)
			throw new Error(
				"Night Shift could not turn on notifications here. Try again.",
			);
		return targetView(kept);
	};
