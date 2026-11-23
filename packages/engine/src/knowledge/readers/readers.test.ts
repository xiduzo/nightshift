import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PageReaderSetting } from "@nightshift/flows";
import { kitCommand } from "@nightshift/flows/testing";
import { NIGHT_SHIFT } from "../../contract";
import { tinyPdf } from "../../testing/documents";
import { firecrawlReader } from "./adapters/out/firecrawl-page-reader";
import { jinaReader } from "./adapters/out/jina-page-reader";
import { localReader } from "./adapters/out/local-page-reader";
import type { PageRead } from "./domain/page-read";
import { createPageReaders } from "./test-support";

/**
 * The page readers against a small site on this computer: `Bun.serve`
 * answers as the site, as Jina Reader and as Firecrawl. No request leaves
 * this computer.
 */

type Answer = {
	status?: number;
	type?: string;
	body: string | Uint8Array;
	headers?: Record<string, string>;
};

/** What the site answers, by path. A path not here is 404. */
let site: Record<string, Answer | ((request: Request) => Answer)> = {};
/** Every request the server saw: method, path and its headers. */
let seen: { method: string; path: string; headers: Headers; body: string }[] =
	[];
let server: ReturnType<typeof Bun.serve>;
let base = "";
let dataDir = "";

const open = { privateNetwork: true };

const ARTICLE = `<!doctype html><html><head><title>Refund policy</title>
<link rel="alternate" type="application/rss+xml" href="/feed.xml">
</head><body><nav><a href="/docs/">Docs</a> <a href="/docs/pricing#plans">Pricing</a></nav>
<main><article><h1>Refund policy</h1>
<p>${"Refunds take fourteen days after we receive the item back. ".repeat(8)}</p>
<p>See <a href="/docs/shipping">shipping</a> and <a href="mailto:help@example.com">mail</a>.</p>
<h2>Exceptions</h2><p>Gift cards are final.</p></article></main></body></html>`;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const url = new URL(request.url);
			seen.push({
				method: request.method,
				path: url.pathname + url.search,
				headers: request.headers,
				body: request.method === "POST" ? await request.text() : "",
			});
			const entry = site[url.pathname];
			const answer = typeof entry === "function" ? entry(request) : entry;
			if (!answer) return new Response("Not found", { status: 404 });
			return new Response(answer.body, {
				status: answer.status ?? 200,
				headers: {
					"content-type": answer.type ?? "text/html; charset=utf-8",
					...answer.headers,
				},
			});
		},
	});
	base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

beforeEach(async () => {
	site = {};
	seen = [];
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-readers-"));
	return () => rm(dataDir, { recursive: true, force: true });
});

const read = (
	reader: { read: typeof local.read },
	path: string,
	before?: PageRead,
) =>
	reader.read(
		`${base}${path}`,
		before && "mark" in before ? { before: before.mark } : {},
	);

const local = localReader({ rules: () => open });

describe("Night Shift's own reader", () => {
	test("reads the main content of a page as Markdown, with every link of the page", async () => {
		site["/docs/refunds"] = { body: ARTICLE };
		const page = await read(local, "/docs/refunds");
		expect(page.status).toBe("read");
		if (page.status !== "read") return;
		expect(page.title).toBe("Refund policy");
		expect(page.markdown).toContain("Gift cards are final.");
		expect(page.markdown).toContain("## Exceptions");
		expect(page.markdown).not.toContain("Pricing");
		// The navigation's links too, absolute, without a fragment; no mail link.
		expect(page.links).toEqual(
			expect.arrayContaining([
				`${base}/docs/`,
				`${base}/docs/pricing`,
				`${base}/docs/shipping`,
			]),
		);
		expect(page.links.some((link) => link.startsWith("mailto:"))).toBe(false);
		expect(page.contentType).toBe("text/html");
		// It names Night Shift, never the person.
		expect(seen[0]?.headers.get("user-agent")).toContain(
			"NightShift-knowledge/1",
		);
	});

	test("a page that did not change reads as unchanged: by its ETag, else by its text", async () => {
		site["/tagged"] = (request) =>
			request.headers.get("if-none-match") === '"v1"'
				? { status: 304, body: "" }
				: { body: ARTICLE, headers: { etag: '"v1"' } };
		const first = await read(local, "/tagged");
		expect(first.status === "read" && first.mark.etag).toBe('"v1"');
		const second = await read(local, "/tagged", first);
		expect(second).toEqual({
			status: "unchanged",
			mark: expect.objectContaining({ etag: '"v1"' }),
		});

		site["/plain"] = { body: ARTICLE };
		const one = await read(local, "/plain");
		expect(await read(local, "/plain", one)).toMatchObject({
			status: "unchanged",
		});
		site["/plain"] = { body: ARTICLE.replace("final", "never refunded") };
		expect(await read(local, "/plain", one)).toMatchObject({ status: "read" });
	});

	test("says why a page is not read: gone, sign-in, blocked, a browser", async () => {
		site["/gone"] = { status: 410, body: "Gone" };
		site["/private"] = { status: 401, body: "No" };
		site["/forbidden"] = { status: 403, body: "No robots" };
		site["/team"] = {
			status: 302,
			body: "",
			headers: { location: "/login?next=/team" },
		};
		site["/login"] = { body: "<form><input type=password></form>" };
		site["/wall"] = {
			body: '<html><body><p>Welcome back.</p><input type="password"></body></html>',
		};
		site["/app"] = {
			body: '<html><head><script src="/app.js"></script></head><body><div id="root"></div><noscript>Turn on JavaScript.</noscript></body></html>',
		};
		expect(await read(local, "/gone")).toMatchObject({ status: "gone" });
		expect(await read(local, "/missing")).toMatchObject({ status: "gone" });
		expect(await read(local, "/private")).toMatchObject({ status: "signin" });
		expect(await read(local, "/forbidden")).toMatchObject({
			status: "blocked",
		});
		expect(await read(local, "/team")).toMatchObject({ status: "signin" });
		expect(await read(local, "/wall")).toMatchObject({ status: "signin" });
		expect(await read(local, "/app")).toMatchObject({
			status: "needs-browser",
		});
	});

	test("a feed reads as its newest items; a PDF as its text", async () => {
		site["/feed.xml"] = {
			type: "application/rss+xml",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Example news</title>
<item><title>Older</title><link>${base}/news/1</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>First &lt;b&gt;item&lt;/b&gt;.</description></item>
<item><title>Newer</title><link>${base}/news/2</link><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><description>Second.</description></item>
</channel></rss>`,
		};
		const feed = await read(local, "/feed.xml");
		expect(feed.status).toBe("read");
		if (feed.status !== "read") return;
		expect(feed.title).toBe("Example news");
		expect(feed.markdown.indexOf("Newer")).toBeLessThan(
			feed.markdown.indexOf("Older"),
		);
		expect(feed.markdown).toContain(
			`## [Newer](${base}/news/2)\n\n_2026-11-09_\n\nSecond.`,
		);
		expect(feed.markdown).toContain("First item.");
		expect(feed.links).toEqual([`${base}/news/2`, `${base}/news/1`]);

		site["/handbook.pdf"] = {
			type: "application/pdf",
			body: tinyPdf(["Holidays are in the calendar."], { title: "Handbook" }),
		};
		const pdf = await read(local, "/handbook.pdf");
		expect(pdf).toMatchObject({ status: "read", title: "Handbook" });
		expect(pdf.status === "read" && pdf.markdown).toContain(
			"Holidays are in the calendar.",
		);
	});

	test("never reads a private address where the rule says no", async () => {
		site["/docs/refunds"] = { body: ARTICLE };
		const closed = localReader({ rules: () => ({ privateNetwork: false }) });
		const page = await read(closed, "/docs/refunds");
		expect(page).toMatchObject({ status: "blocked" });
		expect(seen).toEqual([]);
	});
});

describe("Jina Reader", () => {
	const answer = (target: string) =>
		target.endsWith("/gone")
			? `Title: Not Found\n\nURL Source: ${target}\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nGone.`
			: target.endsWith("/bot")
				? "Title: Just a moment...\n\nWarning: This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.\n\nMarkdown Content:\nWait."
				: `Title: Docs\n\nURL Source: ${target}\n\nMarkdown Content:\nThe docs. See [A](/docs/a) and [B](https://example.org/b#x).`;

	test("reads its text format, with the key as a Bearer token", async () => {
		const jina = jinaReader({
			address: `${base}/r`,
			key: "k3y",
			rules: () => open,
		});
		site["/r/https://example.com/docs"] = (request) => ({
			type: "text/plain",
			body: answer(new URL(request.url).pathname.slice(3)),
		});
		const page = await jina.read("https://example.com/docs", {});
		expect(page).toMatchObject({
			status: "read",
			title: "Docs",
			markdown: "The docs. See [A](/docs/a) and [B](https://example.org/b#x).",
			links: ["https://example.com/docs/a", "https://example.org/b"],
		});
		expect(seen[0]?.path).toBe("/r/https://example.com/docs");
		expect(seen[0]?.headers.get("authorization")).toBe("Bearer k3y");
		if (page.status !== "read") return;
		expect(
			await jina.read("https://example.com/docs", { before: page.mark }),
		).toMatchObject({
			status: "unchanged",
		});
	});

	test("its warnings say a page is gone or checks for robots", async () => {
		const jina = jinaReader({ address: `${base}/r/`, rules: () => open });
		site["/r/https://example.com/gone"] = {
			type: "text/plain",
			body: answer("https://example.com/gone"),
		};
		site["/r/https://example.com/bot"] = {
			type: "text/plain",
			body: answer("https://example.com/bot"),
		};
		expect(await jina.read("https://example.com/gone", {})).toMatchObject({
			status: "gone",
		});
		expect(await jina.read("https://example.com/bot", {})).toMatchObject({
			status: "blocked",
		});
		expect(seen[0]?.headers.get("authorization")).toBeNull();
	});
});

describe("Firecrawl", () => {
	test("scrapes Markdown and links on its v2 API, and maps a site", async () => {
		site["/fc/v2/scrape"] = (request) => ({
			type: "application/json",
			body: JSON.stringify(
				request.headers.get("authorization") !== "Bearer fc-key"
					? { success: false, error: "Unauthorized" }
					: {
							success: true,
							data: {
								markdown: "# Pricing\n\nPlans start at ten.",
								links: [
									"https://example.com/docs/a",
									{ url: "https://example.com/docs/b#top" },
								],
								metadata: {
									title: "Pricing",
									statusCode: 200,
									contentType: "text/html; charset=utf-8",
								},
							},
						},
			),
		});
		site["/fc/v2/map"] = {
			type: "application/json",
			body: JSON.stringify({
				success: true,
				links: [
					{ url: "https://example.com/docs/a", title: "A" },
					{ url: "https://example.com/docs/b" },
				],
			}),
		};
		const firecrawl = firecrawlReader({
			address: `${base}/fc/`,
			key: "fc-key",
			rules: () => open,
		});
		expect(
			await firecrawl.read("https://example.com/pricing", {}),
		).toMatchObject({
			status: "read",
			title: "Pricing",
			markdown: "# Pricing\n\nPlans start at ten.",
			links: ["https://example.com/docs/a", "https://example.com/docs/b"],
			contentType: "text/html",
		});
		expect(JSON.parse(seen[0]?.body ?? "")).toMatchObject({
			url: "https://example.com/pricing",
			formats: ["markdown", "links"],
		});
		expect(
			await firecrawl.map?.("https://example.com/docs/", { limit: 10 }),
		).toEqual(["https://example.com/docs/a", "https://example.com/docs/b"]);
	});

	test("a page's own status says it is gone; the cloud without a key is not asked", async () => {
		site["/fc/v2/scrape"] = {
			type: "application/json",
			body: JSON.stringify({
				success: true,
				data: { markdown: "", metadata: { statusCode: 404 } },
			}),
		};
		const self = firecrawlReader({ address: `${base}/fc`, rules: () => open });
		expect(await self.read("https://example.com/old", {})).toMatchObject({
			status: "gone",
		});
		seen = [];
		const cloud = firecrawlReader({
			address: "https://api.firecrawl.dev",
			rules: () => open,
		});
		expect(await cloud.read("https://example.com/old", {})).toMatchObject({
			status: "failed",
			reason: expect.stringContaining("needs a key"),
		});
		expect(seen).toEqual([]);
	});
});

describe("the step's reader", () => {
	const readers = (setting: PageReaderSetting = { kind: "nightshift" }) =>
		createPageReaders({
			dataDir,
			setting: async () => setting,
			rules: () => open,
		});

	test("answers a page's file with its status, then unchanged; only with the step's token", async () => {
		site["/docs/refunds"] = { body: ARTICLE, headers: { etag: '"r1"' } };
		site["/docs/refunds"] = (request) =>
			request.headers.get("if-none-match") === '"r1"'
				? { status: 304, body: "" }
				: { body: ARTICLE, headers: { etag: '"r1"' } };
		const pages = readers();
		const step = await pages.forStep("p1", async () => undefined);
		const url = step.env.NS_READER_URL ?? "";
		const auth = { authorization: `Bearer ${step.env.NS_READER_TOKEN}` };
		const page = `${base}/docs/refunds`;
		const ask = (path: string, headers: Record<string, string> = auth) =>
			fetch(
				`${url}/${path}${path.includes("?") ? "&" : "?"}url=${encodeURIComponent(page)}`,
				{ headers },
			);

		expect((await ask("read", {})).status).toBe(401);
		const first = await ask("read");
		expect(first.headers.get("x-nightshift-read")).toBe("read");
		const file = await first.text();
		expect(file.startsWith('---\ntitle: "Refund policy"\nsource: ')).toBe(true);
		expect(file).toContain("Gift cards are final.");
		const links = (await (await ask("links")).text()).split("\n");
		expect(links).toContain(`${base}/docs/shipping`);

		const again = await ask("read");
		expect(again.headers.get("x-nightshift-read")).toBe("unchanged");
		expect(await again.text()).toBe("");
		// Asked fresh, it reads the page whole.
		expect((await ask("read?fresh=1")).headers.get("x-nightshift-read")).toBe(
			"read",
		);
		// Night Shift's own reader has no map of a site.
		expect((await ask("map")).status).toBe(204);

		await step.close();
		expect((await ask("read")).status).toBe(410);

		// The marks outlive the step: the next step finds the page unchanged.
		const next = await readers().forStep("p1", async () => undefined);
		const later = await fetch(
			`${next.env.NS_READER_URL}/read?url=${encodeURIComponent(page)}`,
			{
				headers: { authorization: `Bearer ${next.env.NS_READER_TOKEN}` },
			},
		);
		expect(later.headers.get("x-nightshift-read")).toBe("unchanged");
		await next.close();
	});

	test("a page that is gone says so, with why", async () => {
		const step = await readers().forStep("p1", async () => undefined);
		const answer = await fetch(
			`${step.env.NS_READER_URL}/read?url=${encodeURIComponent(`${base}/gone`)}`,
			{
				headers: { authorization: `Bearer ${step.env.NS_READER_TOKEN}` },
			},
		);
		expect(answer.headers.get("x-nightshift-read")).toBe("gone");
		expect(await answer.text()).toBe("The page is not there any more.");
		await step.close();
	});

	test("a service reader gets its key from the step's secret, by the setting's name", async () => {
		site["/fc/v2/map"] = (request) => ({
			type: "application/json",
			body: JSON.stringify({
				success: true,
				links: [request.headers.get("authorization")],
			}),
		});
		const asked: string[] = [];
		const step = await readers({
			kind: "firecrawl",
			address: `${base}/fc`,
			secret: "CRAWL_KEY",
		}).forStep("p1", async (name) => {
			asked.push(name);
			return "secret-value";
		});
		const map = await fetch(
			`${step.env.NS_READER_URL}/map?limit=5&url=${encodeURIComponent("https://example.com/")}`,
			{
				headers: { authorization: `Bearer ${step.env.NS_READER_TOKEN}` },
			},
		);
		expect(asked).toEqual(["CRAWL_KEY"]);
		// The answer's link is the header Firecrawl got: not a web address, so left out.
		expect(map.status).toBe(200);
		expect(seen[0]?.headers.get("authorization")).toBe("Bearer secret-value");
		await step.close();
	});
});

describe("whether the reader is ready", () => {
	const ready = (
		setting: PageReaderSetting,
		saved: Record<string, string> = {},
	) =>
		createPageReaders({
			dataDir,
			setting: async () => setting,
			rules: () => open,
			secret: async (name) => saved[name],
		}).ready("p1");

	test("Night Shift's own reader needs no key", async () => {
		expect(await ready({ kind: "nightshift" })).toBe(true);
	});

	test("a service reader is ready when its secret is saved: the default name, or the one the setting names", async () => {
		expect(await ready({ kind: "firecrawl" })).toBe(false);
		expect(
			await ready({ kind: "firecrawl" }, { FIRECRAWL_API_KEY: "fc-1" }),
		).toBe(true);
		expect(
			await ready(
				{ kind: "jina", secret: "TEAM_JINA" },
				{ JINA_API_KEY: "j-1" },
			),
		).toBe(false);
		expect(
			await ready({ kind: "jina", secret: "TEAM_JINA" }, { TEAM_JINA: "j-2" }),
		).toBe(true);
	});

	test("a secret that cannot be read counts as not saved", async () => {
		const readers = createPageReaders({
			dataDir,
			setting: async () => ({ kind: "jina" }),
			rules: () => open,
			secret: async () => {
				throw new Error("locked");
			},
		});
		expect(await readers.ready("p1")).toBe(false);
	});
});

describe("the quick look", () => {
	const look = (
		urls: string[],
		setting: PageReaderSetting = { kind: "nightshift" },
	) =>
		createPageReaders({
			dataDir,
			setting: async () => setting,
			rules: () => open,
		}).look(NIGHT_SHIFT, "space-1", "p1", urls);

	test("a page that starts a folder the sitemap lists is a section, and names its feed", async () => {
		site["/robots.txt"] = {
			type: "text/plain",
			body: `User-agent: *\nDisallow: /docs/private\nSitemap: ${base}/map.xml`,
		};
		site["/map.xml"] = {
			type: "application/xml",
			body: `<urlset><url><loc>${base}/docs/</loc></url><url><loc>${base}/docs/a</loc></url><url><loc>${base}/docs/b?x=1</loc></url><url><loc>${base}/blog/c</loc></url></urlset>`,
		};
		site["/docs/"] = { body: ARTICLE };
		site["/docs/refunds"] = { body: ARTICLE };
		const [section, article, refused] = await look([
			`${base}/docs/`,
			`${base}/docs/refunds`,
			`${base}/docs/private/x`,
		]);
		expect(section).toEqual({
			url: `${base}/docs/`,
			kind: "section",
			title: "Refund policy",
			section: {
				folder: `${base}/docs/`,
				pages: 3,
				from: "sitemap",
				starts: true,
			},
			feed: `${base}/feed.xml`,
			items: null,
			fileType: null,
			reason: null,
		});
		expect(article).toMatchObject({
			kind: "page",
			section: { pages: 3, starts: false },
		});
		expect(refused).toMatchObject({ kind: "blocked" });
	});

	test("without a sitemap, the page's links count the folder", async () => {
		site["/docs/refunds"] = { body: ARTICLE };
		const [page] = await look([`${base}/docs/refunds`]);
		expect(page).toMatchObject({
			kind: "page",
			section: { folder: `${base}/docs/`, from: "links", starts: false },
		});
	});

	test("a feed, a file, a video page, a sign-in and a gone page, by their answers", async () => {
		site["/news.rss"] = {
			type: "application/rss+xml",
			body: '<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><item><title>A</title></item><item><title>B</title></item></channel></rss>',
		};
		site["/files/handbook"] = {
			type: "application/pdf",
			body: tinyPdf(["Hi."]),
		};
		site["/watch"] = {
			body: '<html><head><title>Talk</title><meta property="og:video" content="https://cdn.example/v.mp4"></head><body><p>A talk.</p></body></html>',
		};
		site["/app"] = { status: 401, body: "" };
		const looks = await look([
			`${base}/news.rss`,
			`${base}/files/handbook`,
			`${base}/watch`,
			`${base}/app`,
			`${base}/gone`,
			"not a link",
		]);
		expect(looks.map((one) => one.kind)).toEqual([
			"feed",
			"file",
			"media",
			"signin",
			"gone",
			"failed",
		]);
		expect(looks[0]).toMatchObject({
			title: "News",
			items: { count: 2, perWeek: null },
		});
		expect(looks[1]).toMatchObject({ fileType: "pdf" });
		expect(looks[2]).toMatchObject({ title: "Talk" });
	});

	test("what this computer cannot read, the project's reader tries", async () => {
		site["/app"] = {
			body: '<html><head><script src="/app.js"></script></head><body><div id="root"></div></body></html>',
		};
		const target = `${base}/app`;
		site[`/r/${target}`] = {
			type: "text/plain",
			body: `Title: The app\n\nURL Source: ${target}\n\nMarkdown Content:\nThe app's text.`,
		};
		const [own] = await look([target]);
		expect(own).toMatchObject({ kind: "needs-browser" });
		const [jina] = await look([target], {
			kind: "jina",
			address: `${base}/r/`,
		});
		expect(jina).toMatchObject({ kind: "page", title: "The app" });
	});
});

describe("the Web pages kit with the step's reader", () => {
	/** Runs the kit's sync as a step runs it, with the step's reader. */
	async function sync(inputs: Record<string, string>) {
		const knowledge = join(dataDir, "folder");
		const output = join(dataDir, "output.json");
		await writeFile(output, "");
		const pages = createPageReaders({
			dataDir,
			setting: async () => ({ kind: "nightshift" }),
			rules: () => open,
		});
		const step = await pages.forStep("p1", async () => undefined);
		const { command, env } = kitCommand(
			"kit:knowledge/web",
			"sync",
			{},
			inputs,
		);
		const proc = Bun.spawn(["/bin/sh", "-c", command], {
			env: {
				PATH: process.env.PATH ?? "",
				...env,
				...step.env,
				NS_KNOWLEDGE: knowledge,
				NS_OUTPUT: output,
				NS_WEB_PAUSE: "0",
				// Never the public reader.
				NS_WEB_READER: "http://127.0.0.1:9/",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [log, code] = await Promise.all([
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		await step.close();
		const written = await readFile(output, "utf8");
		return { code, log, data: written ? JSON.parse(written) : null };
	}

	test("a crawl reads each page on this computer, and a later sync keeps what did not change", async () => {
		site["/docs/"] = {
			body: `<html><head><title>Docs</title></head><body><nav><a href="/docs/refunds">Refunds</a></nav><main><p>${"Start here to learn how the shop works. ".repeat(10)}</p></main></body></html>`,
			headers: { etag: '"d1"' },
		};
		site["/docs/refunds"] = { body: ARTICLE };
		const first = await sync({
			urls: `${base}/docs/`,
			follow: "true",
			depth: "1",
		});
		expect(first.code).toBe(0);
		const host = `127.0.0.1-${server.port}`;
		const folder = join(dataDir, "folder", "web");
		expect((await readdir(folder)).sort()).toEqual([
			`${host}-docs-refunds.md`,
			`${host}-docs.md`,
		]);
		const refunds = await readFile(
			join(folder, `${host}-docs-refunds.md`),
			"utf8",
		);
		expect(
			refunds.startsWith(
				`---\ntitle: "Refund policy"\nsource: ${base}/docs/refunds\n---\n\n`,
			),
		).toBe(true);
		expect(refunds).toContain("Gift cards are final.");
		expect(first.data).toEqual({ files: 2, skipped: "" });

		// The next sync: the start page answers 304, the article reads the same.
		site["/docs/"] = (request) =>
			request.headers.get("if-none-match") === '"d1"'
				? { status: 304, body: "" }
				: { status: 500, body: "" };
		const kept = "A copy that shows the sync kept it.";
		await writeFile(join(folder, `${host}-docs-refunds.md`), kept);
		const second = await sync({
			urls: `${base}/docs/`,
			follow: "true",
			depth: "1",
		});
		expect(second.code).toBe(0);
		expect(second.log).toBe("");
		expect(
			await readFile(join(folder, `${host}-docs-refunds.md`), "utf8"),
		).toBe(kept);
		expect(second.data).toEqual({ files: 2, skipped: "" });
	});
});
