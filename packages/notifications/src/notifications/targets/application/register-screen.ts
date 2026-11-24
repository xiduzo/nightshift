import type { PersonActor } from "@nightshift/engine";
import type {
	PushTargetView,
	RegisterTarget as TargetInput,
} from "../domain/push-targets";
import type { registerTarget } from "./register-target";

export type RegisterScreenPorts = {
	/** The slice's own registration of a target: it checks the screen. */
	registerTarget: ReturnType<typeof registerTarget>;
};

/** The screen, and the session that registers it (null: none). */
export type RegisterScreen = { screen: TargetInput; sessionId: string | null };

/**
 * Registers a screen for the Person who asks. No role applies, and nobody
 * registers a screen for another Person.
 */
export const registerScreen =
	(ports: RegisterScreenPorts) =>
	async (
		actor: PersonActor,
		request: RegisterScreen,
	): Promise<PushTargetView> =>
		ports.registerTarget({
			personId: actor.personId,
			screen: request.screen,
			sessionId: request.sessionId,
		});
