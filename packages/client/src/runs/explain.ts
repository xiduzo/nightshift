import type { ExplanationEvent } from "@nightshift/flows";

/** The one procedure "Ask why" needs. The app's client has it, a test passes a fake. */
export type ExplainClient = {
	assistant: {
		explain: (
			input: { runId: string },
			options: { signal?: AbortSignal },
		) => Promise<AsyncIterable<ExplanationEvent>>;
	};
};

/** Why an answer did not come. The server's own words when it says why. */
export const NO_EXPLANATION = "The agent stopped without an answer. Ask again.";

/**
 * Asks the computer the app talks to why a run did not finish, and reads
 * the stream to its answer: what went wrong, and what you can do. Each
 * `activity` goes to `onActivity` ("Reads the run"). Throws an `Error`
 * with words for the person when no answer comes, and the API's error
 * for a refusal (the role, a run not found).
 */
export async function explainRun(
	client: ExplainClient,
	runId: string,
	options: { signal?: AbortSignal; onActivity?: (text: string) => void } = {},
): Promise<string> {
	const events = await client.assistant.explain(
		{ runId },
		options.signal ? { signal: options.signal } : {},
	);
	let answer: string | null = null;
	for await (const event of events) {
		if (event.type === "activity") options.onActivity?.(event.text);
		else if (event.type === "answer") answer = event.answer;
		else if (event.type === "error") throw new Error(event.message);
		else if (event.type === "done") break;
	}
	if (answer === null) throw new Error(NO_EXPLANATION);
	return answer;
}

/**
 * The mutation of "Ask why" for one run: each call asks the agent again,
 * and costs a model call. Its key holds the run, so a screen that opens
 * again finds the last answer (`useMutationState`). A failed ask does not
 * try again on its own.
 */
export function askWhyMutation(client: ExplainClient, runId: string) {
	return {
		mutationKey: ["assistant", "explain", { runId }] as const,
		mutationFn: () => explainRun(client, runId),
		retry: false as const,
	};
}
