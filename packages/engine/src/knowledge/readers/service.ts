import {
	PAGE_READ_HEADER,
	PAGE_READER_DEFAULTS,
	PAGE_READER_ENV,
	type PageReaderSetting,
} from "@nightshift/flows";
import type { AddressRules } from "../../web-access";
import { openReaderRoute } from "./endpoint";
import { firecrawlReader } from "./firecrawl";
import { jinaReader } from "./jina";
import { localReader } from "./local";
import { createLook, type LinkLook } from "./look";
import { createReadMarks } from "./marks";
import type { PageRead, PageReader } from "./reader";

/**
 * The page readers of this computer's projects (ADR 39), as one module:
 * the reader a project's setting names, built with its key; the step's
 * reader on the loopback listener, for a sync flow's Command step; the
 * marks that tell a page did not change; and the quick look at a link.
 */

/** A secret's value by its name, from the scopes of one use, or undefined when it is not saved. */
export type ReaderSecret = (name: string) => Promise<string | undefined>;

export type PageReaders = {
	/**
	 * A Command step of the project starts: its reader on the loopback
	 * listener, in `NS_READER_URL` and `NS_READER_TOKEN`, until `close`. A key
	 * the reader needs comes from `secret`, the step's scopes.
	 */
	forStep(
		projectId: string,
		secret: ReaderSecret,
	): Promise<{ env: Record<string, string>; close(): Promise<void> }>;
	/** The quick look at each link, in their order, with the project's reader. */
	look(projectId: string, urls: readonly string[]): Promise<LinkLook[]>;
	/** Writes the marks that wait. */
	close(): Promise<void>;
};

type PageReadersDeps = {
	dataDir: string;
	/** The project's reader setting, as its Space has it. */
	setting(projectId: string): Promise<PageReaderSetting>;
	/** Where a reader of this computer may connect now. */
	rules: () => AddressRules;
	/** A secret outside a run, for the quick look. */
	secret?: ReaderSecret;
};

/** How many links one look takes at once. */
const LOOKS_AT_ONCE = 4;

/** A page's file in the knowledge: its title and address above its Markdown. */
export function pageFile(
	url: string,
	read: Extract<PageRead, { status: "read" }>,
): string {
	const title = JSON.stringify(read.title.replace(/\s+/g, " ").trim());
	return `---\ntitle: ${title}\nsource: ${url}\n---\n\n${read.markdown.trim()}\n`;
}

export function createPageReaders(deps: PageReadersDeps): PageReaders {
	const local = localReader({ rules: deps.rules });
	const marks = createReadMarks(deps.dataDir);
	const looks = createLook({ local, rules: deps.rules });

	/** The reader a setting names, with its key from `secret`. */
	async function readerOf(
		setting: PageReaderSetting,
		secret: ReaderSecret | undefined,
	): Promise<PageReader> {
		if (setting.kind === "nightshift") return local;
		const defaults = PAGE_READER_DEFAULTS[setting.kind];
		const name = setting.secret ?? defaults.secret;
		const key = (await secret?.(name).catch(() => undefined)) || undefined;
		const service = {
			address: setting.address ?? defaults.address,
			...(key ? { key } : {}),
			rules: deps.rules,
		};
		return setting.kind === "jina"
			? jinaReader(service)
			: firecrawlReader(service);
	}

	const lines = (urls: readonly string[]) =>
		new Response(urls.length > 0 ? `${urls.join("\n")}\n` : "", {
			headers: { "content-type": "text/plain; charset=utf-8" },
		});

	/** The answer to one read of the step: the page's file, or why it was not read. */
	async function answerRead(
		projectId: string,
		reader: PageReader,
		params: URLSearchParams,
		signal: AbortSignal,
		links: Map<string, string[]>,
	): Promise<Response> {
		const url = params.get("url") ?? "";
		if (!/^https?:\/\//i.test(url)) {
			return new Response("Give the page as url=https://…", { status: 400 });
		}
		const before =
			params.get("fresh") === "1"
				? undefined
				: (await marks.get(projectId, reader.kind, url))?.mark;
		const read = await reader.read(url, {
			...(before ? { before } : {}),
			signal,
		});
		const answer = (status: string, body: string) =>
			new Response(body, {
				headers: {
					"content-type": "text/plain; charset=utf-8",
					[PAGE_READ_HEADER]: status,
				},
			});
		switch (read.status) {
			case "read":
				links.set(url, read.links);
				await marks.set(projectId, reader.kind, url, read);
				return answer("read", pageFile(url, read));
			case "unchanged": {
				const kept = await marks.get(projectId, reader.kind, url);
				await marks.set(projectId, reader.kind, url, {
					mark: read.mark,
					links: kept?.links ?? [],
				});
				return answer("unchanged", "");
			}
			default:
				return answer(read.status, read.reason);
		}
	}

	return {
		async forStep(projectId, secret) {
			const reader = await readerOf(await deps.setting(projectId), secret);
			/** The links of each page this step read, for `links`. */
			const links = new Map<string, string[]>();
			const route = await openReaderRoute({
				async handle(action, params, signal) {
					switch (action) {
						case "read":
							return answerRead(projectId, reader, params, signal, links);
						case "links": {
							const url = params.get("url") ?? "";
							return lines(
								links.get(url) ??
									(await marks.get(projectId, reader.kind, url))?.links ??
									[],
							);
						}
						case "map": {
							const start = params.get("url") ?? "";
							if (!reader.map || !/^https?:\/\//i.test(start)) {
								return new Response(null, { status: 204 });
							}
							const limit = Math.min(
								Math.max(Number(params.get("limit")) || 100, 1),
								5_000,
							);
							return lines(await reader.map(start, { limit, signal }));
						}
						default:
							return new Response("Not found.", { status: 404 });
					}
				},
			});
			return {
				env: {
					[PAGE_READER_ENV.url]: route.url,
					[PAGE_READER_ENV.token]: route.token,
				},
				async close() {
					route.close();
					await marks.flush();
				},
			};
		},
		async look(projectId, urls) {
			const reader = await readerOf(await deps.setting(projectId), deps.secret);
			const results: LinkLook[] = new Array(urls.length);
			let next = 0;
			const worker = async () => {
				while (next < urls.length) {
					const index = next++;
					results[index] = await looks.look(
						projectId,
						urls[index] as string,
						reader,
					);
				}
			};
			await Promise.all(
				Array.from({ length: Math.min(LOOKS_AT_ONCE, urls.length) }, worker),
			);
			return results;
		},
		close: () => marks.flush(),
	};
}
