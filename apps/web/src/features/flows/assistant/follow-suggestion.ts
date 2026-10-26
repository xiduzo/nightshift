import type {
	Suggestion,
	SuggestionEvent,
	SuggestionRequest,
} from "@nightshift/flows";
import { followStream } from "./follow-stream";

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
	const end = await followStream(
		() => client.assistant.suggest(request, { signal }),
		signal,
		(event) => {
			if (event.type === "activity") onActivity(event.text);
			else if (event.type === "suggestion") suggestion = event.suggestion;
		},
	);
	if (end.kind === "error") return { ok: false, message: end.message };
	if (end.kind === "broken" && end.message)
		return { ok: false, message: end.message };
	return suggestion
		? { ok: true, suggestion }
		: { ok: false, message: NO_SUGGESTION };
}
