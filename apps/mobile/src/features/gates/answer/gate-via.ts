/** Where an answer from the phone app comes from. */
export const PHONE_VIA = "phone" as const;

/** Adds the phone app to an answer, for `gates.resolve`. */
export function phoneGateAnswer<T extends object>(answer: T) {
	return { ...answer, via: PHONE_VIA };
}
