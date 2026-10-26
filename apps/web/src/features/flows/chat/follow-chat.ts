import type { ChatEvent, ChatRequest } from "@nightshift/flows";
import { followStream, type StreamEnd } from "../assistant/follow-stream";

/** The one procedure the chat needs. The app's client has it, a test passes a fake. */
export type ChatClient = {
	assistant: {
		chat: (
			input: ChatRequest,
			options: { signal: AbortSignal },
		) => Promise<AsyncIterable<ChatEvent>>;
	};
};

export const NO_ANSWER =
	"The agent stopped without an answer. Send your message again.";

/**
 * Sends one message and reads the answer to its end, each event to
 * `onEvent`. A broken answer always says why.
 */
export async function followChat({
	client,
	request,
	signal,
	onEvent,
}: {
	client: ChatClient;
	request: ChatRequest;
	signal: AbortSignal;
	onEvent: (event: ChatEvent) => void;
}): Promise<StreamEnd> {
	const end = await followStream(
		() => client.assistant.chat(request, { signal }),
		signal,
		onEvent,
	);
	return end.kind === "broken"
		? { kind: "broken", message: end.message ?? NO_ANSWER }
		: end;
}
