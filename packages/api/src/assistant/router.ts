import { chatRequestSchema, suggestionRequestSchema } from "@nightshift/flows";
import { z } from "zod";

import { stream } from "../output";
import { ownerProcedure, readable } from "../procedures";
import { runProcedure } from "../runs";
import {
	chatEventSchema,
	explanationEventSchema,
	suggestionEventSchema,
} from "./schemas";

/** Ends the controller's signal when the client goes away. */
function follow(signal: AbortSignal | undefined): AbortController {
	const controller = new AbortController();
	signal?.addEventListener("abort", () => controller.abort(), { once: true });
	return controller;
}

/**
 * The assistant runs on this computer's own profiles and reads its Clone of
 * the project, so a suggestion and a chat are its owner's. It never writes
 * a flow: the person applies what it suggests and saves. The explanation
 * of a run only reads, so the run's Space decides who may ask.
 */
export const assistant = {
	suggest: ownerProcedure
		.route({
			summary:
				"Streams a suggestion for one field of a flow or of one of its nodes: a prompt, output data, variables, outcomes, rules, a command, tool arguments, the description or the inputs.",
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
	/**
	 * Why a run that stopped early did not finish, in one short answer, and
	 * what the person can do. Unlike the chat, it is for a Member of the
	 * run's Space who may continue or retry the run (`run.resume`), on any
	 * computer of the Space: the phone asks the Host. The answer costs the
	 * computer's agent, so a viewer may not ask. It runs on the profile for
	 * help of the computer that answers, in the project's Clone there, read only.
	 */
	explain: runProcedure(z.object({ runId: z.string() }), { run: ["resume"] })
		.route({
			summary:
				"Streams one short answer: why a run that stopped early did not finish, and what the person can do.",
		})
		.output(stream(explanationEventSchema))
		.handler(async function* ({ context, input, signal, path }) {
			const controller = follow(signal);
			try {
				yield* context.assistant.explain(input.runId, controller.signal, {
					spaceId: context.spaceId,
					personId: context.session.user.id,
				});
			} catch (error) {
				throw readable(error, path);
			}
		}),
};
