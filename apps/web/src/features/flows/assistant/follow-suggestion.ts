import type {
	Suggestion,
	SuggestionEvent,
	SuggestionRequest,
} from "@nightshift/flows";

/** What one suggestion request gave: the suggestion, or why there is none. */
export type SuggestionResult =
	| { ok: true; suggestion: Suggestion }
	| { ok: false; message: string };

/** The one procedure a suggestion needs. The app's client has it, a test passes a fake. */
export type SuggestClient = {
	assistant: {
		suggest: (
			input: SuggestionRequest,
			options: { signal: AbortSignal },
		) => Promise<AsyncIterable<SuggestionEvent>>;
	};
};

export const NO_SUGGESTION =
	"The agent stopped without a suggestion. Try again, or say more about what you want.";

/**
 * Asks for one suggestion and reads its stream to the end: each `activity`
 * line goes to `onActivity`, the last `suggestion` wins, and an `error`
 * ends it with the server's own words. A stream that ends without a
 * suggestion is an error too. Aborting `signal` stops the stream; the
 * result then does not matter to the caller.
 */
export async function followSuggestion({
	client,
	request,
	signal,
	onActivity,
}: {
	client: SuggestClient;
	request: SuggestionRequest;
	signal: AbortSignal;
	onActivity: (text: string) => void;
}): Promise<SuggestionResult> {
	let suggestion: Suggestion | null = null;
	try {
		const events = await client.assistant.suggest(request, { signal });
		for await (const event of events) {
			if (event.type === "activity") onActivity(event.text);
			else if (event.type === "suggestion") suggestion = event.suggestion;
			else if (event.type === "error")
				return { ok: false, message: event.message };
			else if (event.type === "done") break;
		}
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error && error.message ? error.message : NO_SUGGESTION,
		};
	}
	return suggestion
		? { ok: true, suggestion }
		: { ok: false, message: NO_SUGGESTION };
}
