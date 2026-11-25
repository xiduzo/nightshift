import { Refusal } from "@nightshift/refusal";
import { z } from "zod";

/**
 * The project's question set: questions agents asked the knowledge, each
 * with the files a person marked as its answer. The evaluation
 * (`evaluate.ts`) runs them against each way to search.
 *
 * It is a file of the knowledge, `evals/questions.json`, so it syncs with
 * the Space like the learnings do (ADR 4), and every computer evaluates the
 * same set. `evals/` is Night Shift's own (`isQuestionSetPath`): no index, search
 * or read shows it.
 */

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

const fileSchema = z.looseObject({
	version: z.literal(1),
	questions: z.array(z.unknown()),
});

/** One question as a key: two ways to write the same words are one question. */
export function questionKey(query: string): string {
	return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The questions of the set's file. A file that is not valid, and each question in it that is not, counts as none. */
export function parseQuestions(text: string | null): KnowledgeQuestion[] {
	return (fileOf(text)?.questions ?? []).flatMap((item) => {
		const parsed = questionSchema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
}

/** The set's file, each question as it is stored. Null: there is none, or it does not read. */
function fileOf(text: string | null) {
	if (text === null) return null;
	try {
		return fileSchema.parse(JSON.parse(text));
	} catch {
		return null;
	}
}

/** The set's file for `questions`. */
export function formatQuestions(
	questions: readonly KnowledgeQuestion[],
): string {
	return write({ version: 1, questions });
}

const write = (file: object) => `${JSON.stringify(file, null, 2)}\n`;

/**
 * The set's file with `query` marked: its answers replaced, or with no
 * answers left out of the set. The newest mark comes first. A question it
 * cannot read stays as it is. Refuses a file it cannot read.
 */
export function markQuestion(
	text: string | null,
	mark: {
		query: string;
		answers: readonly string[];
		at: number;
		by: string | null;
	},
): string {
	const file = text === null ? { version: 1, questions: [] } : fileOf(text);
	if (file === null) {
		throw new Refusal(
			"conflict",
			"Night Shift cannot read the saved questions. Update Night Shift to change them.",
		);
	}
	const key = questionKey(mark.query);
	const others = file.questions.filter((item) => {
		const parsed = questionSchema.safeParse(item);
		return !parsed.success || questionKey(parsed.data.query) !== key;
	});
	const answers = [...new Set(mark.answers.map((path) => path.trim()))].filter(
		(path) => path !== "",
	);
	const marked: KnowledgeQuestion = {
		query: mark.query.trim(),
		answers,
		markedAt: mark.at,
		by: mark.by,
	};
	return write({
		...file,
		questions: answers.length === 0 ? others : [marked, ...others],
	});
}
