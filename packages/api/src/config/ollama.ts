import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { ollamaModelSchema, ollamaStatusSchema } from "./schemas";

/**
 * The Ollama search by meaning uses, for the Settings page: where it is,
 * whether it answers and has the model, its models, and a download of one.
 * The model and the address themselves are settings.
 */
export const ollama = {
	status: ownerProcedure
		.route({
			summary:
				"Says which Ollama Night Shift uses, whether it answers, and whether it has the embedding model.",
		})
		.output(output(ollamaStatusSchema))
		.handler(({ context }) => context.ollama.status()),
	models: ownerProcedure
		.route({
			summary: "Lists the embedding models the Ollama Night Shift uses has.",
		})
		.output(output(z.array(ollamaModelSchema)))
		.handler(({ context }) => context.ollama.models()),
	/** Starts a download in the background: `status` says how far it is. */
	pull: ownerProcedure
		.route({
			summary:
				"Starts to download a model into the Ollama Night Shift uses, in the background.",
		})
		.output(output(z.null()))
		.input(
			z.object({
				model: z
					.string()
					.trim()
					.min(1)
					.max(200)
					.regex(/^[\w.:/-]+$/, "Use a model name such as bge-m3."),
			}),
		)
		.handler(({ context, input }) => {
			context.ollama.pull(input.model);
			return null;
		}),
};
