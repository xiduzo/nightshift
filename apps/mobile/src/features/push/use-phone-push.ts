import { usePushRegistration } from "./registration";
import { useClearAnswered } from "./use-clear-answered";

/**
 * The push work of a signed-in phone: it registers with the Host at every
 * start, and clears the notifications of Gates that no longer wait. Use it
 * once, behind the sign-in.
 */
export function usePhonePush(): void {
	usePushRegistration();
	useClearAnswered();
}
