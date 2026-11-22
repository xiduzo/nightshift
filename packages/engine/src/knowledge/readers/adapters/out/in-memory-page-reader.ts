import type { PageReader } from "../../application/ports";
import {
	fingerprintOf,
	type NotRead,
	type PageRead,
	type ReadMark,
} from "../../domain/page-read";

/** A page a test puts where a reader would read it. */
export type TwinPage = {
	title: string;
	markdown: string;
	links?: string[];
	contentType?: string;
};

/**
 * A `PageReader` in memory. A test puts the pages it reads (`put`), says
 * why a page is not read (`refuse`), and gives the site's map (`mapTo`).
 * It reads which pages were asked, with what mark (`asked`). A page that
 * is not there reads as gone, and a page whose fingerprint did not change
 * as unchanged, as every reader does.
 */
export function inMemoryPageReader(kind: PageReader["kind"] = "nightshift") {
	const pages = new Map<string, TwinPage>();
	const refused = new Map<string, NotRead>();
	let site: string[] | null = null;
	const twin = {
		kind,
		/** Every read, in order: the address and the mark it came with. */
		asked: [] as { url: string; before?: ReadMark }[],
		/** Every map asked, in order. */
		maps: [] as { start: string; limit: number }[],
		/** Puts a page at `url`, or changes it. */
		put(url: string, page: TwinPage) {
			refused.delete(url);
			pages.set(url, page);
		},
		/** From now on the page at `url` is not read, for this reason. */
		refuse(url: string, notRead: NotRead) {
			refused.set(url, notRead);
		},
		/** The reader finds the site's addresses itself: these. */
		mapTo(urls: string[]) {
			site = urls;
		},
		async read(
			url: string,
			options: { before?: ReadMark; signal?: AbortSignal },
		): Promise<PageRead> {
			twin.asked.push({
				url,
				...(options.before ? { before: options.before } : {}),
			});
			const no = refused.get(url);
			if (no) return no;
			const page = pages.get(url);
			if (!page) {
				return { status: "gone", reason: "The page is not there any more." };
			}
			const mark = { fingerprint: fingerprintOf(page.title, page.markdown) };
			if (options.before?.fingerprint === mark.fingerprint) {
				return { status: "unchanged", mark };
			}
			return {
				status: "read",
				title: page.title,
				markdown: page.markdown,
				links: page.links ?? [],
				mark,
				contentType: page.contentType ?? "text/html",
			};
		},
	};
	const map: PageReader["map"] = async (start, { limit }) => {
		twin.maps.push({ start, limit });
		return (site ?? []).slice(0, limit);
	};
	return {
		...twin,
		get map() {
			return site === null ? undefined : map;
		},
	} satisfies PageReader & typeof twin;
}

export type InMemoryPageReader = ReturnType<typeof inMemoryPageReader>;
