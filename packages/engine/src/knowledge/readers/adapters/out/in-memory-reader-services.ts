import type { ReaderServices } from "../../application/ports";
import type { Looked, ReadMark, Seen } from "../../domain/page-read";
import {
	type InMemoryPageReader,
	inMemoryPageReader,
} from "./in-memory-page-reader";

/**
 * `ReaderServices` in memory. Night Shift's own reader and each service's
 * reader are in-memory page readers a test fills (`local`, `jina`,
 * `firecrawl`). What a look sees of a page is what a test says (`see`),
 * else what the own reader reads there. It records each service reader
 * made, with its address and key (`made`).
 */
export function inMemoryReaderServices() {
	const looks = new Map<string, Omit<Looked, "url"> & { url?: string }>();
	const local = inMemoryPageReader("nightshift");
	const services = {
		jina: inMemoryPageReader("jina"),
		firecrawl: inMemoryPageReader("firecrawl"),
	};
	// Firecrawl finds a site's addresses itself, as the real one does.
	services.firecrawl.mapTo([]);
	const twin = {
		local: local as InMemoryPageReader,
		jina: services.jina,
		firecrawl: services.firecrawl,
		/** Every service reader made, in order. */
		made: [] as { kind: "jina" | "firecrawl"; address: string; key?: string }[],
		/** Every look, in order: the address and its timeout. */
		looked: [] as { url: string; timeoutMs?: number }[],
		/** What a look sees at `url` (null: the server said it did not change). */
		see(
			url: string,
			seen: Seen | null,
			more: { contentType?: string; url?: string } = {},
		) {
			looks.set(url, { seen, contentType: more.contentType ?? "", ...more });
		},
		async look(
			url: string,
			options: { before?: ReadMark; signal?: AbortSignal; timeoutMs?: number },
		): Promise<Looked> {
			twin.looked.push({
				url,
				...(options.timeoutMs !== undefined
					? { timeoutMs: options.timeoutMs }
					: {}),
			});
			const said = looks.get(url);
			if (said) return { ...said, url: said.url ?? url };
			const read = await local.read(url, options);
			if (read.status === "read") {
				return {
					seen: {
						kind: "html",
						title: read.title,
						markdown: read.markdown,
						links: read.links,
						feeds: [],
						media: false,
						words: read.markdown.split(/\s+/).length,
					},
					contentType: read.contentType,
					url,
				};
			}
			return {
				seen: read.status === "unchanged" ? null : read,
				contentType: "",
				url,
			};
		},
		service(
			kind: "jina" | "firecrawl",
			options: { address: string; key?: string },
		) {
			twin.made.push({ kind, ...options });
			return services[kind];
		},
	};
	return twin satisfies ReaderServices;
}

export type InMemoryReaderServices = ReturnType<typeof inMemoryReaderServices>;
