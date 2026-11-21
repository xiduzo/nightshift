import type { ContentTexts } from "../../application/ports";
import { cleanPath } from "../../domain/paths";
import { textResult } from "../../domain/text";

/** `ContentTexts` in memory: every content is plain text. It keeps each path it is asked for. */
export function inMemoryContentTexts() {
	const twin = {
		/** The paths asked for, in order. */
		asked: [] as string[],
		async text(path: string, content: Uint8Array, maxBytes: number) {
			twin.asked.push(path);
			const clean = cleanPath(path);
			if (clean === null) return null;
			const bytes = Math.max(1, maxBytes);
			const start = Buffer.from(content.subarray(0, bytes)).toString("utf8");
			return textResult(clean, start, content.length, bytes);
		},
	};
	return twin satisfies ContentTexts;
}

export type InMemoryContentTexts = ReturnType<typeof inMemoryContentTexts>;
