/** Where an answer from the web app comes from. */
export const WEB_VIA = "web" as const;

/** Adds the web app to an answer, for `gates.resolve`. */
export function webGateAnswer<T extends object>(answer: T) {
	return { ...answer, via: WEB_VIA };
}
