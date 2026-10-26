import type { AssistantService } from "@nightshift/flows";

/** Placeholder until the assistant runs on a profile: every request ends with an error. */
export function createAssistant(): AssistantService {
	const unavailable = async function* () {
		yield {
			type: "error",
			message: "The assistant is not available yet.",
		} as const;
	};
	return { suggest: unavailable, chat: unavailable };
}
