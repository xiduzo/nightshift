import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tinyDocx, tinyPdf } from "../testing/documents";
import { createKnowledgeFolders } from "./folder";
import {
	createKnowledgeSearch,
	type KnowledgeHit,
	type KnowledgeSearch,
	matchQuery,
	SEARCH_FILE,
} from "./search";

let dataDir: string;
let dir: string;
let search: KnowledgeSearch;
beforeEach(async () => {
	dataDir = await mkdtemp(join(tmpdir(), "nightshift-search-"));
	dir = await createKnowledgeFolders(dataDir).ensure("p1");
	search = createKnowledgeSearch(dataDir);
});
afterEach(async () => {
	search.close();
	await rm(dataDir, { recursive: true, force: true });
});

const put = async (path: string, text: string, at?: number) => {
	await mkdir(join(dir, path, ".."), { recursive: true });
	await writeFile(join(dir, path), text);
	if (at !== undefined) await utimes(join(dir, path), at / 1000, at / 1000);
};
const paths = (hits: KnowledgeHit[]) => hits.map((hit) => hit.path);
const snippet = (hit: KnowledgeHit | undefined) =>
	hit?.snippet.map((p) => (p.match ? `[${p.text}]` : p.text)).join("") ?? "";

describe("knowledge search", () => {
	test("indexes the text files, with a title, and finds them by word, stem and prefix", async () => {
		await put(
			"wiki/deploy.md",
			"# Deploy guide\n\nWe deploy the app every night from the main branch.\n",
		);
		await put("notes.txt", "Release notes: deploying needs a green build.\n");
		await put("image.png", "deploy");
		expect(paths(await search.search("p1", "deploy"))).toEqual([
			"wiki/deploy.md",
			"notes.txt",
		]);
		const [hit] = await search.search("p1", "branch");
		expect(hit?.title).toBe("Deploy guide");
		expect(paths(await search.search("p1", "deploying")).sort()).toEqual([
			"notes.txt",
			"wiki/deploy.md",
		]);
		expect(paths(await search.search("p1", "rele"))).toEqual(["notes.txt"]);
		expect(await search.search("p1", "kubernetes")).toEqual([]);
	});

	test("leaves out the index, hidden files, staging files and the learnings that wait", async () => {
		await put("INDEX.md", "# Knowledge index\n\n- `a.md`: secret word\n");
		await put("index.md", "secret word in another case");
		await put("wiki.part/a.md", "secret word, half");
		await put("web/b.md.part", "secret word, half");
		await put(".hidden/a.md", "secret word");
		await put("learnings/proposed/r1.md", "- secret word");
		await put("learnings/accepted/r0.md", "- secret word kept");
		expect(paths(await search.search("p1", "secret"))).toEqual([
			"learnings/accepted/r0.md",
		]);
	});

	test("ranks a word in the title over one in the body, and a word that comes often higher", async () => {
		await put("a.md", "# Notes\n\nThe cache is cleared on start.\n");
		await put("b.md", "# Cache\n\nHow the store keeps things.\n");
		await put("c.md", "# Store\n\nCache this, cache that, cache all of it.\n");
		const hits = await search.search("p1", "cache");
		expect(paths(hits)).toEqual(["b.md", "c.md", "a.md"]);
		const scores = hits.map((h) => h.score);
		expect([...scores].sort((x, y) => y - x)).toEqual(scores);
	});

	test("gives an excerpt with the matches marked, on one line", async () => {
		await put(
			"long.md",
			`# Long\n\n${"filler words here. ".repeat(40)}\nThe secret handshake is\nthree knocks.\n${"more filler. ".repeat(40)}`,
		);
		const [hit] = await search.search("p1", "handshake");
		const text = snippet(hit);
		expect(text).toContain("[handshake]");
		expect(text).not.toContain("\n");
		expect(text.length).toBeLessThan(200);
	});

	test("a phrase matches only its words in order", async () => {
		await put("a.md", "the night shift runs flows");
		await put("b.md", "shift the night");
		expect(paths(await search.search("p1", '"night shift"'))).toEqual(["a.md"]);
		expect(paths(await search.search("p1", "night shift")).sort()).toEqual([
			"a.md",
			"b.md",
		]);
	});

	test("every word must match, and when no file has them all, some will do", async () => {
		await put("a.md", "apples and pears");
		await put("b.md", "apples only");
		expect(paths(await search.search("p1", "apples pears"))).toEqual(["a.md"]);
		expect(paths(await search.search("p1", "pears bananas"))).toEqual(["a.md"]);
	});

	test("refreshes on each search: a changed file, a new one, one that went", async () => {
		await put("a.md", "alpha", 1_000_000);
		await put("b.md", "bravo", 1_000_000);
		expect(await search.refresh("p1")).toEqual({
			files: 2,
			indexed: 2,
			removed: 0,
		});
		expect(await search.refresh("p1")).toEqual({
			files: 2,
			indexed: 0,
			removed: 0,
		});
		await put("a.md", "alpha changed to charlie", 2_000_000);
		await put("c.md", "delta");
		await rm(join(dir, "b.md"));
		expect(paths(await search.search("p1", "charlie"))).toEqual(["a.md"]);
		expect(paths(await search.search("p1", "delta"))).toEqual(["c.md"]);
		expect(await search.search("p1", "bravo")).toEqual([]);
		expect(await search.refresh("p1")).toEqual({
			files: 2,
			indexed: 0,
			removed: 0,
		});
	});

	test("a change of the same size at another time is read again", async () => {
		await put("a.md", "aaaa", 1_000_000);
		await search.refresh("p1");
		await put("a.md", "bbbb", 3_000_000);
		expect(paths(await search.search("p1", "bbbb"))).toEqual(["a.md"]);
	});

	test("keeps projects apart", async () => {
		const other = await createKnowledgeFolders(dataDir).ensure("p2");
		await put("a.md", "shared word");
		await writeFile(join(other, "b.md"), "shared word");
		expect(paths(await search.search("p1", "shared"))).toEqual(["a.md"]);
		expect(paths(await search.search("p2", "shared"))).toEqual(["b.md"]);
	});

	test("no query string throws, and one without a word finds nothing", async () => {
		await put(
			"a.md",
			"# A\n\nNEAR the column title: body (and) more AND OR NOT.\n",
		);
		const hostile = [
			"",
			"   ",
			'"',
			'"unclosed phrase',
			"*",
			"***",
			"a*b",
			"NEAR(a b)",
			"title:body",
			"body:",
			"(and)",
			"AND",
			"OR NOT",
			"-near",
			"^title",
			"{title body}: x",
			"'; DROP TABLE files; --",
			"\u0000",
			"🙂",
			'a"b"c',
			'""',
			"x".repeat(5000),
		];
		for (const input of hostile) {
			await expect(search.search("p1", input)).resolves.toBeArray();
		}
		expect(paths(await search.search("p1", "NEAR(the column"))).toEqual([
			"a.md",
		]);
		expect(paths(await search.search("p1", "AND"))).toEqual(["a.md"]);
		expect(await search.search("p1", "🙂")).toEqual([]);
	});

	test("refuses a project id that leaves the knowledge", async () => {
		await expect(search.search("../p1", "x")).rejects.toThrow();
	});

	test("builds a broken index file again", async () => {
		await put("a.md", "alpha");
		search.close();
		await writeFile(
			join(dataDir, "knowledge", SEARCH_FILE),
			"not a database at all, ".repeat(400),
		);
		search = createKnowledgeSearch(dataDir);
		expect(paths(await search.search("p1", "alpha"))).toEqual(["a.md"]);
	});
});

describe("matchQuery", () => {
	test("quotes every word, keeps phrases and makes the last word a prefix", () => {
		expect(matchQuery("deploy app", "all")).toBe('"deploy" "app"*');
		expect(matchQuery('"night shift" run*', "any")).toBe(
			'"night shift" OR "run"*',
		);
		expect(matchQuery('say "hello there"', "all")).toBe('"say" "hello there"');
		expect(matchQuery("* () :", "all")).toBeNull();
	});
});

describe("PDF and Word files", () => {
	const putBytes = async (path: string, bytes: Uint8Array) => {
		await mkdir(join(dir, path, ".."), { recursive: true });
		await writeFile(join(dir, path), bytes);
	};

	test("are found by the words of their text, with a title and the page", async () => {
		await putBytes(
			"docs/release.pdf",
			tinyPdf(["Release checklist", "We ship the quokka service on Fridays."]),
		);
		await putBytes(
			"docs/onboarding.docx",
			tinyDocx("Onboarding guide", ["Every new teammate meets the wombat."]),
		);
		const [pdf] = await search.search("p1", "quokka");
		expect(pdf?.path).toBe("docs/release.pdf");
		expect(pdf?.title).toBe("Release checklist");
		expect(snippet(pdf)).toContain("[quokka]");
		expect(pdf?.page).toBe(1);
		const [docx] = await search.search("p1", "wombat");
		expect(docx?.path).toBe("docs/onboarding.docx");
		expect(docx?.title).toBe("Onboarding guide");
		expect(docx?.page).toBeNull();
	});

	test("one that does not open is found by its path", async () => {
		await putBytes("broken.pdf", new TextEncoder().encode("not a pdf"));
		expect(paths(await search.search("p1", "broken"))).toEqual(["broken.pdf"]);
	});
});
