import { z } from "zod";
import { EVALS_DIR } from "./folder";

/**
 * The project's question set: questions agents asked the knowledge, each
 * with the files a person marked as its answer. The evaluation
 * (`evaluate.ts`) runs them against each way to search.
 *
 * It is a file of the knowledge, `evals/questions.json`, so it syncs with
 * the Space like the learnings do (ADR 4), and every computer evaluates the
 * same set. `evals/` is Night Shift's own (`isEvalsPath`): no index, search
 * or read shows it.
 */

/** The question set's file in the knowledge. */
export const QUESTIONS_FILE = `${EVALS_DIR}/questions.json`;

/** One question of the set: what an agent asked, and the files that answer it. */
export type KnowledgeQuestion = {
	/** As the agent asked it. */
	query: string;
	/** The paths in the knowledge that answer it. Never empty. */
	answers: string[];
	/** Epoch ms: when a person marked it last. */
	markedAt: number;
	/** The Person who marked it. Null: not known. */
	by: string | null;
};

const questionSchema = z.object({
	query: z.string().min(1).max(1000),
	answers: z.array(z.string().min(1)).min(1),
	markedAt: z.number().finite(),
	by: z.string().nullable(),
});

const fileSchema = z.object({
	version: z.literal(1),
	questions: z.array(z.unknown()),
});

/** One question as a key: two ways to write the same words are one question. */
export function questionKey(query: string): string {
	return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The questions of the set's file. A file that is not valid, and each question in it that is not, counts as none. */
export function parseQuestions(text: string | null): KnowledgeQuestion[] {
	if (text === null) return [];
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return [];
	}
	const file = fileSchema.safeParse(json);
	if (!file.success) return [];
	return file.data.questions.flatMap((question) => {
		const parsed = questionSchema.safeParse(question);
		return parsed.success ? [parsed.data] : [];
	});
}

/** The set's file for `questions`. */
export function formatQuestions(
	questions: readonly KnowledgeQuestion[],
): string {
	return `${JSON.stringify({ version: 1, questions }, null, 2)}\n`;
}

/**
 * The set with `query` marked: its answers replaced, or with no answers
 * left out of the set. The newest mark comes first.
 */
export function markQuestion(
	questions: readonly KnowledgeQuestion[],
	mark: {
		query: string;
		answers: readonly string[];
		at: number;
		by: string | null;
	},
): KnowledgeQuestion[] {
	const key = questionKey(mark.query);
	const others = questions.filter((q) => questionKey(q.query) !== key);
	const answers = [...new Set(mark.answers.map((path) => path.trim()))].filter(
		(path) => path !== "",
	);
	if (answers.length === 0) return others;
	return [
		{ query: mark.query.trim(), answers, markedAt: mark.at, by: mark.by },
		...others,
	];
}
