import { afterAll, beforeAll } from "bun:test";
import { inMemoryPageReader } from "./in-memory-page-reader";
import { jinaReader } from "./jina-page-reader";
import { localReader } from "./local-page-reader";
import { pageReaderContract } from "./page-reader.contract";

/**
 * The contract of `PageReader`, on the in-memory adapter and on two real
 * ones: Night Shift's own reader against a small site on this computer, and
 * Jina Reader against a Reader on this computer that answers in its text
 * format. No request leaves this computer.
 */

type Page = { title: string; text: string };

let pages = new Map<string, Page>();
let server: ReturnType<typeof Bun.serve>;
let base = "";
const open = () => ({ privateNetwork: true });

const html = (page: Page) =>
	`<!doctype html><html><head><title>${page.title}</title></head><body><main><article><h1>${page.title}</h1><p>${page.text}</p></article></main></body></html>`;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname.startsWith("/jina/")) {
				const target = new URL(url.pathname.slice("/jina/".length));
				const page = pages.get(target.pathname);
				const body = page
					? `Title: ${page.title}\n\nURL Source: ${target.href}\n\nMarkdown Content:\n${page.text}`
					: `Title: Not Found\n\nURL Source: ${target.href}\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nGone.`;
				return new Response(body, {
					headers: { "content-type": "text/plain" },
				});
			}
			const page = pages.get(url.pathname);
			if (!page) return new Response("Not found", { status: 404 });
			return new Response(html(page), {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

pageReaderContract("in memory", async () => {
	const reader = inMemoryPageReader();
	return {
		reader,
		url: (path) => `https://example.com${path}`,
		publish: (path, page) =>
			reader.put(`https://example.com${path}`, {
				title: page.title,
				markdown: page.text,
			}),
		close: async () => {},
	};
});

pageReaderContract("Night Shift's own reader", async () => {
	pages = new Map();
	return {
		reader: localReader({ rules: open }),
		url: (path) => `${base}${path}`,
		publish: (path, page) => pages.set(path, page),
		close: async () => {},
	};
});

pageReaderContract("Jina Reader", async () => {
	pages = new Map();
	return {
		reader: jinaReader({ address: `${base}/jina/`, rules: open }),
		url: (path) => `https://example.com${path}`,
		publish: (path, page) => pages.set(path, page),
		close: async () => {},
	};
});
