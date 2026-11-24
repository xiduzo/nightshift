import { describe, expect, test } from "bun:test";
import { allowing } from "../../../access/adapters/out/in-memory-access";
import { NIGHT_SHIFT } from "../../../contract";
import { inMemoryReadersPorts } from "../adapters/out/in-memory-neighbours";
import { lookAtLinks } from "./look-at-links";

/** The use case lookAtLinks, on in-memory adapters. The twins of "the quick look" in `readers.test.ts`. */

const SITE = "https://example.com";

const page = (title: string, links: string[] = []) => ({
	title,
	markdown: `# ${title}\n\nThe text of the page.`,
	links,
});

describe("lookAtLinks", () => {
	test("a page that starts a folder the sitemap lists is a section, and names its feed", async () => {
		const ports = inMemoryReadersPorts();
		ports.sites.serve(
			`${SITE}/robots.txt`,
			`User-agent: *\nDisallow: /docs/private\nSitemap: ${SITE}/map.xml`,
		);
		ports.sites.serve(
			`${SITE}/map.xml`,
			`<urlset><url><loc>${SITE}/docs/</loc></url><url><loc>${SITE}/docs/a</loc></url><url><loc>${SITE}/docs/b?x=1</loc></url><url><loc>${SITE}/blog/c</loc></url></urlset>`,
		);
		ports.services.see(`${SITE}/docs/`, {
			kind: "html",
			title: "Refund policy",
			markdown: "Refunds.",
			links: [],
			feeds: [`${SITE}/feed.xml`],
			media: false,
			words: 1,
		});
		ports.services.local.put(`${SITE}/docs/refunds`, page("Refund policy"));
		const [section, article, refused] = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [`${SITE}/docs/`, `${SITE}/docs/refunds`, `${SITE}/docs/private/x`],
		});
		expect(section).toEqual({
			url: `${SITE}/docs/`,
			kind: "section",
			title: "Refund policy",
			section: {
				folder: `${SITE}/docs/`,
				pages: 3,
				from: "sitemap",
				starts: true,
			},
			feed: `${SITE}/feed.xml`,
			items: null,
			fileType: null,
			reason: null,
		});
		expect(article).toMatchObject({
			kind: "page",
			section: { pages: 3, starts: false },
		});
		expect(refused).toMatchObject({
			kind: "blocked",
			reason: "The site asks readers to stay away from this page.",
		});
	});

	test("without a sitemap, the page's links count the folder", async () => {
		const ports = inMemoryReadersPorts();
		ports.services.local.put(
			`${SITE}/docs/refunds`,
			page("Refund policy", [`${SITE}/docs/shipping`, `${SITE}/blog/x`]),
		);
		const [one] = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [`${SITE}/docs/refunds`],
		});
		expect(one).toMatchObject({
			kind: "page",
			section: {
				folder: `${SITE}/docs/`,
				pages: 2,
				from: "links",
				starts: false,
			},
		});
	});

	test("a reader with its own map counts the folder when the sitemap does not", async () => {
		const ports = inMemoryReadersPorts();
		await (await ports.documents.open("p1")).setReader({ kind: "firecrawl" });
		ports.services.firecrawl.mapTo([`${SITE}/docs/a`, `${SITE}/docs/b`]);
		ports.services.local.put(`${SITE}/docs/a`, page("A"));
		const [one] = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [`${SITE}/docs/a`],
		});
		expect(one).toMatchObject({ section: { pages: 2, from: "map" } });
		expect(ports.services.firecrawl.maps).toEqual([
			{ start: `${SITE}/docs/`, limit: 500 },
		]);
	});

	test("a feed, a file, a video page, a sign-in and a gone page, by their answers", async () => {
		const ports = inMemoryReadersPorts();
		const at = ports.clock.at;
		ports.services.see(`${SITE}/news.rss`, {
			kind: "feed",
			title: "News",
			markdown: "# News",
			links: [],
			dates: [at - 86_400_000, at - 2 * 86_400_000, at - 60 * 86_400_000],
			items: 3,
		});
		ports.services.see(`${SITE}/files/handbook`, {
			kind: "file",
			type: "pdf",
			title: "handbook",
			markdown: "Hi.",
		});
		ports.services.see(`${SITE}/watch`, {
			kind: "html",
			title: "Talk",
			markdown: "A talk.",
			links: [],
			feeds: [],
			media: true,
			words: 2,
		});
		ports.services.see(`${SITE}/app`, {
			status: "signin",
			reason: "The page asks you to sign in first.",
		});
		const looks = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [
				`${SITE}/news.rss`,
				`${SITE}/files/handbook`,
				`${SITE}/watch`,
				`${SITE}/app`,
				`${SITE}/gone`,
				"not a link",
				"ftp://example.com/file",
			],
		});
		expect(looks.map((one) => one.kind)).toEqual([
			"feed",
			"file",
			"media",
			"signin",
			"gone",
			"failed",
			"failed",
		]);
		expect(looks[0]).toMatchObject({
			title: "News",
			items: { count: 3, perWeek: 0.5 },
		});
		expect(looks[1]).toMatchObject({ fileType: "pdf" });
		expect(looks[2]).toMatchObject({
			title: "Talk",
			reason: "This is video or audio. An agent can get its transcript.",
		});
		expect(looks[3]).toMatchObject({
			reason: "The page asks you to sign in first.",
		});
		expect(looks[5]).toMatchObject({
			url: "not a link",
			reason: "This is not a web address.",
		});
		expect(looks[6]).toMatchObject({
			reason: "The address must start with http:// or https://.",
		});
	});

	test("a page that did not answer is a failed look", async () => {
		const ports = inMemoryReadersPorts();
		ports.services.see(`${SITE}/slow`, null);
		const [one] = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [`${SITE}/slow`],
		});
		expect(one).toMatchObject({
			kind: "failed",
			reason: "The page did not answer.",
		});
	});

	test("what this computer cannot read, the project's reader tries", async () => {
		const ports = inMemoryReadersPorts();
		const target = `${SITE}/app`;
		ports.services.see(target, {
			status: "needs-browser",
			reason: "The page shows its text only in a browser.",
		});
		ports.services.jina.put(target, page("The app"));
		const [own] = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [target],
		});
		expect(own).toMatchObject({ kind: "needs-browser" });
		await (await ports.documents.open("p1")).setReader({
			kind: "jina",
			address: "https://jina.example/",
		});
		const [jina] = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [target],
		});
		expect(jina).toMatchObject({ kind: "page", title: "The app" });
		expect(ports.services.made).toEqual([
			{ kind: "jina", address: "https://jina.example/" },
		]);
	});

	test("a service reader gets the key of this computer's secret, by the setting's name", async () => {
		const ports = inMemoryReadersPorts();
		await (await ports.documents.open("p1")).setReader({
			kind: "firecrawl",
			secret: "CRAWL_KEY",
		});
		const asked: string[] = [];
		await lookAtLinks({
			...ports,
			secret: async (name) => {
				asked.push(name);
				return "fc-1";
			},
		})(NIGHT_SHIFT, { spaceId: "space-1", projectId: "p1", urls: [] });
		expect(asked).toEqual(["CRAWL_KEY"]);
		expect(ports.services.made).toEqual([
			{ kind: "firecrawl", address: "https://api.firecrawl.dev", key: "fc-1" },
		]);
	});

	test("a look is kept five minutes; a failed look is not kept", async () => {
		const ports = inMemoryReadersPorts();
		const look = lookAtLinks(ports);
		const url = `${SITE}/docs/a`;
		const broken = `${SITE}/broken`;
		ports.services.local.put(url, page("A"));
		ports.services.see(broken, {
			status: "failed",
			reason: "The site answered with an error (500).",
		});
		await look(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [url, broken],
		});
		ports.services.local.put(url, page("A again"));
		ports.clock.at += 4 * 60_000;
		const [kept] = await look(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [url],
		});
		expect(kept).toMatchObject({ title: "A" });
		await look(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [broken],
		});
		expect(
			ports.services.looked.filter((one) => one.url === broken),
		).toHaveLength(2);
		ports.clock.at += 60_000;
		const [fresh] = await look(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls: [url],
		});
		expect(fresh).toMatchObject({ title: "A again" });
		expect(ports.services.looked[0]).toEqual({ url, timeoutMs: 8_000 });
	});

	test("the looks come back in the order of the links, four at a time", async () => {
		const ports = inMemoryReadersPorts();
		const urls = Array.from({ length: 9 }, (_, index) => `${SITE}/p${index}`);
		for (const [index, url] of urls.entries()) {
			ports.services.local.put(url, page(`Page ${index}`));
		}
		const looks = await lookAtLinks(ports)(NIGHT_SHIFT, {
			spaceId: "space-1",
			projectId: "p1",
			urls,
		});
		expect(looks.map((one) => one.title)).toEqual(
			urls.map((_, index) => `Page ${index}`),
		);
	});

	test("owners, admins and members may, and nobody else", async () => {
		const ports = inMemoryReadersPorts();
		expect(
			await ports.access.whoMay("space-1", (actor) =>
				lookAtLinks(ports)(actor, {
					spaceId: "space-1",
					projectId: "p1",
					urls: [],
				}),
			),
		).toEqual(allowing("owner", "admin", "member"));
	});
});
