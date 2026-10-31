import { usePushPrefetch } from "./prefetch";
import { usePushRegistration } from "./registration";

/**
 * The push work of a signed-in phone: it registers with the Host at every
 * start, and a push reads what it opens as it comes. Use it once, behind
 * the sign-in.
 */
export function usePhonePush(): void {
	usePushRegistration();
	usePushPrefetch();
}
