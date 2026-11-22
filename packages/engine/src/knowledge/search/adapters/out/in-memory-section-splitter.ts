import type { SectionSplitter } from "../../application/ports";
import {
	emptySection,
	headingsByLine,
	isMarkdown,
	pagesOf,
	placedSection,
} from "../../domain/sections";

/**
 * `SectionSplitter` in memory: one section per page, its whole text, under
 * the headings open at its first line. It records the paths it split
 * (`split`).
 */
export function inMemorySectionSplitter() {
	const twin = {
		/** The paths split, in order. */
		paths: [] as string[],
		async split(...[path, content]: Parameters<SectionSplitter["split"]>) {
			twin.paths.push(path);
			const pages = pagesOf(content);
			if (pages.length === 0) return [emptySection(path)];
			return pages.map(({ text, page }) =>
				placedSection(
					path,
					text.trim(),
					{ line: 1, page },
					isMarkdown(path) ? headingsByLine(text) : [],
				),
			);
		},
	};
	return twin satisfies SectionSplitter;
}

export type InMemorySectionSplitter = ReturnType<
	typeof inMemorySectionSplitter
>;
