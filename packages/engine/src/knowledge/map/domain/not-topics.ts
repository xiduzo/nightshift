import { Refusal } from "@nightshift/refusal";
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
type NotTopic = {
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

const fileSchema = z.looseObject({
	version: z.literal(1),
	words: z.array(z.unknown()),
});

const keyOf = (word: string) => word.trim().replace(/\s+/g, " ").toLowerCase();

/** The words of the file. A file that is not valid, and each word in it that is not, counts as none. */
export function parseNotTopics(text: string | null): NotTopic[] {
	return (fileOf(text)?.words ?? []).flatMap((item) => {
		const parsed = notTopicSchema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
}

/** The file, each word as it is stored. Null: there is none, or it does not read. */
function fileOf(text: string | null) {
	if (text === null) return null;
	try {
		return fileSchema.parse(JSON.parse(text));
	} catch {
		return null;
	}
}

/**
 * The file with `word` marked as not a topic, or with it put back. The
 * newest mark comes first. A word it cannot read stays as it is. Refuses a
 * file it cannot read.
 */
export function markNotTopic(
	text: string | null,
	mark: { word: string; notTopic: boolean; at: number; by: string | null },
): string {
	const file = text === null ? { version: 1, words: [] } : fileOf(text);
	if (file === null) {
		throw new Refusal(
			"conflict",
			"Night Shift cannot read the saved words. Update Night Shift to change them.",
		);
	}
	const key = keyOf(mark.word);
	const others = file.words.filter((item) => {
		const parsed = notTopicSchema.safeParse(item);
		return !parsed.success || keyOf(parsed.data.word) !== key;
	});
	const marked: NotTopic = {
		word: mark.word.trim().replace(/\s+/g, " "),
		markedAt: mark.at,
		by: mark.by,
	};
	const words = mark.notTopic ? [marked, ...others] : others;
	return `${JSON.stringify({ ...file, words }, null, 2)}\n`;
}
