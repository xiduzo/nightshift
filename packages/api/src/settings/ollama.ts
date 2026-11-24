import { z } from "zod";

import { output } from "../output";
import { ownerProcedure } from "../procedures";
import { ollamaModelSchema, ollamaStatusSchema } from "./schemas";

/** A model name as Ollama knows it. */
const modelName = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.regex(/^[\w.:/-]+$/, "Use a model name such as bge-m3.");

/**
 * The Ollama search by meaning and Decision nodes use, for the Settings
 * and Agents pages: where it is, whether it answers and has a model, its
 * models, and a download of one. The model and the address themselves are
 * settings.
 */
export const ollama = {
	/** Without a model: the embedding model of search by meaning. */
	status: ownerProcedure
		.route({
			summary:
				"Says which Ollama Night Shift uses, whether it answers, and whether it has a model: the embedding model unless another is named.",
		})
		.input(z.object({ model: modelName.optional() }).optional())
		.output(output(ollamaStatusSchema))
		.handler(({ context, input }) =>
			input?.model
				? context.ollama.status(input.model)
				: context.ollama.status(),
		),
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
		.input(z.object({ model: modelName }))
		.handler(({ context, input }) => {
			context.ollama.pull(input.model);
			return null;
		}),
};
