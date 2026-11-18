import { z } from "zod";

/**
 * Files a person adds to the answer of a Gate: notes, images, PDFs. They
 * travel with the answer, as base64, to the Device that walks the run. It
 * keeps them with the run's artifacts, and each agent session of the run
 * gets them on the Device that runs it, in a folder it may read.
 *
 * The limits keep an answer small enough to travel through a Host.
 */

/** One file of an answer. `content` is the file's bytes in base64. An interface, so the declared types stay small. */
export interface AnswerFile {
	name: string;
	/** `text/markdown`, `image/png`, … Empty when the browser does not know. */
	mediaType: string;
	content: string;
}

/** The most files one answer takes. */
export const MAX_ANSWER_FILES = 10;
/** The most bytes the files of one answer take together. */
export const MAX_ANSWER_FILES_BYTES = 10 * 1024 * 1024;

/** The bytes of a base64 string, without decoding it. */
export function base64Bytes(content: string): number {
	const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
	return Math.floor((content.length * 3) / 4) - padding;
}

/** Why the files cannot go with an answer, in words for the person, or null. */
export function answerFilesProblem(
	files: readonly Pick<AnswerFile, "content">[],
): string | null {
	if (files.length > MAX_ANSWER_FILES) {
		return `Add at most ${MAX_ANSWER_FILES} files.`;
	}
	const bytes = files.reduce((sum, file) => sum + base64Bytes(file.content), 0);
	if (bytes > MAX_ANSWER_FILES_BYTES) {
		return `The files are larger than ${MAX_ANSWER_FILES_BYTES / 1024 / 1024} MB together. Add smaller files.`;
	}
	return null;
}

/**
 * The files of an answer: a name without a folder, base64 content, and the
 * limits of `answerFilesProblem`.
 */
export const answerFilesSchema: z.ZodType<AnswerFile[]> = z
	.array(
		z.object({
			name: z
				.string()
				.min(1)
				.max(200)
				.refine(
					(name) => !/[/\\]/.test(name) && name !== "." && name !== "..",
					{
						message: "A file name has no folder.",
					},
				),
			mediaType: z.string().max(200),
			content: z.base64(),
		}),
	)
	.superRefine((files, ctx) => {
		const problem = answerFilesProblem(files);
		if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
	});
