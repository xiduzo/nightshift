import { usePushRegistration } from "./registration";

/**
 * The push work of a signed-in phone: it registers with the Host at every
 * start. Use it once, behind the sign-in.
 */
export function usePhonePush(): void {
	usePushRegistration();
}
