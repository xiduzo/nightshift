import { afterAll, beforeAll } from "bun:test";
import { inMemorySiteFacts } from "./in-memory-site-facts";
import { siteFactsContract } from "./site-facts.contract";
import { webSiteFacts } from "./web-site-facts";

/** The contract of `SiteFacts`, on both adapters. The real side reads a small site on this computer. */

let files = new Map<string, string>();
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			const text = files.get(new URL(request.url).pathname);
			return text === undefined
				? new Response("Not found", { status: 404 })
				: new Response(text, { headers: { "content-type": "text/plain" } });
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

siteFactsContract("in memory", async () => {
	const facts = inMemorySiteFacts();
	const origin = "https://example.com";
	return {
		facts,
		origin,
		serve: (path, text) => facts.serve(`${origin}${path}`, text),
		close: async () => {},
	};
});

siteFactsContract("over the web", async () => {
	files = new Map();
	return {
		facts: webSiteFacts({ rules: () => ({ privateNetwork: true }) }),
		origin: base,
		serve: (path, text) => files.set(path, text),
		close: async () => {},
	};
});
