import type { QuestionSetFile } from "../../application/ports";

/** `QuestionSetFile` in memory: each project's file, by project id. */
export function inMemoryQuestionSetFile() {
	const twin = {
		/** The text of each project's file. */
		files: new Map<string, string>(),
		/** Each write, in order. */
		writes: [] as { projectId: string; text: string }[],
		async read(projectId: string) {
			return twin.files.get(projectId) ?? null;
		},
		async write(projectId: string, text: string) {
			twin.writes.push({ projectId, text });
			twin.files.set(projectId, text);
		},
	};
	return twin satisfies QuestionSetFile;
}

export type InMemoryQuestionSetFile = ReturnType<
	typeof inMemoryQuestionSetFile
>;
