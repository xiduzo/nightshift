/** What kind of refusal it is. The API answers each kind with its own status. */
export type RefusalKind =
	/** The request is not valid. The person changes it and asks again (400). */
	| "invalid"
	/** The request needs a Person who is signed in (401). */
	| "signed-out"
	/** The Person may not do this (403). */
	| "forbidden"
	/** What the request names does not exist, or the Person may not see it (404). */
	| "not-found"
	/** The state now does not allow it. The person waits, or changes the state first (409). */
	| "conflict"
	/** Night Shift cannot do it now. The person tries again later (503). */
	| "unavailable";

/**
 * Night Shift does not do what a person asked. The message is for them:
 * what happened, and how to fix it, with no internals. A `cause` keeps
 * the details for the log (a git error and its output, for example).
 */
export class Refusal extends Error {
	constructor(
		readonly kind: RefusalKind,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "Refusal";
	}
}

/** What a person sees for an error that is not a refusal. The details go to the log. */
export const FAILURE_MESSAGE =
	"Something went wrong. Night Shift saved the details. Try again.";

/** The words a person sees for `error`: a refusal's own, else `FAILURE_MESSAGE`. */
export function wordsFor(error: unknown): string {
	return error instanceof Refusal ? error.message : FAILURE_MESSAGE;
}
