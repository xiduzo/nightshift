import { chatRequestSchema, suggestionRequestSchema } from "@nightshift/flows";

import { stream } from "../output";
import { ownerProcedure, readable } from "../procedures";
import { chatEventSchema, suggestionEventSchema } from "./schemas";

/** Ends the controller's signal when the client goes away. */
function follow(signal: AbortSignal | undefined): AbortController {
	const controller = new AbortController();
	signal?.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

/**
 * The assistant runs on this computer's own profiles and reads its Clone of
 * the project, so it is its owner's. It never writes a flow: the person
 * applies what it suggests and saves.
 */
export const assistant = {
	suggest: ownerProcedure
		.route({
			summary:
				"Streams a suggestion for one field of one node of a flow: its prompt, its output schema or its variable writes.",
		})
		.input(suggestionRequestSchema)
		.output(stream(suggestionEventSchema))
		.handler(async function* ({ context, input, signal, path }) {
			const controller = follow(signal);
			try {
				yield* context.assistant.suggest(input, controller.signal);
			} catch (error) {
				throw readable(error, path);
			}
		}),
	chat: ownerProcedure
		.route({
			summary:
				"Streams the answer to one message in a chat about a flow, and maybe a new version of the flow to apply.",
		})
		.input(chatRequestSchema)
		.output(stream(chatEventSchema))
		.handler(async function* ({ context, input, signal, path }) {
			const controller = follow(signal);
			try {
				yield* context.assistant.chat(input, controller.signal, {
					spaceId: context.spaceId,
					personId: context.session.user.id,
				});
			} catch (error) {
				throw readable(error, path);
			}
		}),
};
