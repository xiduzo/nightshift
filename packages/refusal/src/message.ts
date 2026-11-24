/**
 * What a thrown value says: an error's message, else the value as text.
 * It is not checked to be fit for a person: `wordsFor` gives their words.
 */
export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
