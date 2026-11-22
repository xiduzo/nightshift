import { afterAll, beforeAll } from "bun:test";
import { inMemoryReaderServices } from "./in-memory-reader-services";
import { readerServicesContract } from "./reader-services.contract";
import { webReaderServices } from "./web-reader-services";

/** The contract of `ReaderServices`, on both adapters. The real side reads a small site on this computer. */

type Page = { title: string; text: string };

let pages = new Map<string, Page>();
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			const page = pages.get(new URL(request.url).pathname);
			if (!page) return new Response("Not found", { status: 404 });
			return new Response(
				`<!doctype html><html><head><title>${page.title}</title></head><body><main><article><h1>${page.title}</h1><p>${page.text}</p></article></main></body></html>`,
				{ headers: { "content-type": "text/html; charset=utf-8" } },
			);
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

readerServicesContract("in memory", async () => {
	const services = inMemoryReaderServices();
	return {
		services,
		url: (path) => `https://example.com${path}`,
		publish: (path, page) =>
			services.local.put(`https://example.com${path}`, {
				title: page.title,
				markdown: page.text,
			}),
		close: async () => {},
	};
});

readerServicesContract("over the web", async () => {
	pages = new Map();
	return {
		services: webReaderServices({ rules: () => ({ privateNetwork: true }) }),
		url: (path) => `${base}${path}`,
		publish: (path, page) => pages.set(path, page),
		close: async () => {},
	};
});
