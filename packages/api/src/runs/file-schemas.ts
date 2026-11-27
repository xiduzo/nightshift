import type { Artifact, RunFiles } from "@nightshift/engine";
import { z } from "zod";

import { exact } from "../output";

/**
 * The files of a run: what its agents kept for the person, and its folder
 * on this computer. Each output mirrors the engine's view type exactly
 * (`exact`).
 */

/** A file a run's agent kept for the person, or one a person added to an answer. */
export const artifactSchema = exact<Artifact>()(
	z.object({
		id: z.string(),
		stepId: z.string(),
		name: z.string(),
		title: z.string(),
		mediaType: z.string(),
		size: z.number(),
		savedAt: z.number(),
		/** `answer`: a person added it to the answer of the Gate `stepId`. */
		from: z.literal("answer").optional(),
	}),
);

/**
 * The files of a run of a project without a folder in its folder on this
 * computer, and when the cleanup removes them. Fetch one at
 * `GET /api/runs/:id/files/<path>`.
 */
export const runFilesSchema = exact<RunFiles>()(
	z.object({
		/** The run works in a run folder, and its folder is on this computer. */
		here: z.boolean(),
		/** By path, with `/` between folders. */
		files: z.array(
			z.object({
				path: z.string(),
				size: z.number(),
				modifiedAt: z.number(),
			}),
		),
		/** The folder holds more entries than the list shows. */
		more: z.boolean(),
		/** When the cleanup removes the folder. Null while the run goes on, or when the cleanup is off. */
		cleanupAt: z.number().nullable(),
		/** When this computer removed the folder. */
		removed: z.object({ at: z.number() }).nullable(),
	}),
);
