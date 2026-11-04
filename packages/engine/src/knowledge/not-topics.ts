import { z } from "zod";

/**
 * The words people marked as not a topic, so the Map stops showing them.
 *
 * It is a file of the knowledge, `evals/not-topics.json`, as the question set
 * is: it follows the Space and not the Device, every computer of the Space
 * draws the same Map, and it survives a new computer (ADR 4). `evals/` is
 * Night Shift's own: no index, search or read shows it. Two people who mark a
 * word at the same moment keep the later list, as for the question set.
 */

/** One word a person marked. */
export type NotTopic = {
	/** As the person saw it on the Map. */
	word: string;
	/** Epoch ms: when they marked it. */
	markedAt: number;
	/** The Person who marked it. Null: not known. */
	by: string | null;
};

const notTopicSchema = z.object({
	word: z.string().min(1).max(200),
	markedAt: z.number().finite(),
	by: z.string().nullable(),
});

const fileSchema = z.object({
	version: z.literal(1),
	words: z.array(z.unknown()),
});

const keyOf = (word: string) => word.trim().replace(/\s+/g, " ").toLowerCase();

/** The words of the file. A file that is not valid, and each word in it that is not, counts as none. */
export function parseNotTopics(text: string | null): NotTopic[] {
	if (text === null) return [];
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return [];
	}
	const file = fileSchema.safeParse(json);
	if (!file.success) return [];
	return file.data.words.flatMap((word) => {
		const parsed = notTopicSchema.safeParse(word);
		return parsed.success ? [parsed.data] : [];
	});
}

/** The file for `words`. */
export function formatNotTopics(words: readonly NotTopic[]): string {
	return `${JSON.stringify({ version: 1, words }, null, 2)}\n`;
}

/** The list with `word` marked as not a topic, or with it put back. The newest mark comes first. */
export function markNotTopic(
	words: readonly NotTopic[],
	mark: { word: string; notTopic: boolean; at: number; by: string | null },
): NotTopic[] {
	const key = keyOf(mark.word);
	const others = words.filter((known) => keyOf(known.word) !== key);
	if (!mark.notTopic) return others;
	return [
		{
			word: mark.word.trim().replace(/\s+/g, " "),
			markedAt: mark.at,
			by: mark.by,
		},
		...others,
	];
}
