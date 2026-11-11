import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	type ConvertNode,
	type JsonValue,
	typedOutput,
} from "@nightshift/flows";
import { dataProblem } from "../../output-schema";
import { type Converted, convertValue } from "./formats";
import { ConvertProblem } from "./problem";

/**
 * Each format on a fixture of its own: what it reads into, and that the
 * data matches the shape the format declares in `@nightshift/flows`
 * (`typedOutput`), so a later node's template paths hold.
 */

const fixture = (name: string) =>
	Bun.file(join(import.meta.dir, "fixtures", name)).text();

type Pair = Pick<ConvertNode, "from" | "to" | "delimiter">;

/** The data read from `text`, checked against the format's shape. */
function read(pair: Pair, text: string): JsonValue {
	const made = convertValue(pair, { text });
	if (made.kind !== "data") throw new Error("expected data");
	const node: ConvertNode = {
		id: "convert",
		type: "convert",
		position: { x: 0, y: 0 },
		value: "",
		...pair,
	};
	const schema = typedOutput(node)?.schema;
	expect(schema).toBeDefined();
	expect(dataProblem(schema ?? {}, made.data)).toBeNull();
	return made.data;
}

function write(pair: Pair, json: JsonValue): string {
	const made: Converted = convertValue(pair, { json });
	if (made.kind !== "text") throw new Error("expected text");
	return made.text;
}

function problem(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		if (error instanceof ConvertProblem) return error.message;
		throw error;
	}
	throw new Error("expected a problem");
}

describe("CSV", () => {
	test("reads rows of text: a guessed delimiter, quotes, a BOM, short rows filled", async () => {
		expect(
			read({ from: "csv", to: "json" }, await fixture("sales.csv")),
		).toEqual([
			{ region: "north", amount: "007", note: "first; with a delimiter" },
			{ region: "south", amount: "80", note: "two\nlines" },
			{ region: "east", amount: "15", note: "" },
		]);
	});

	test("writes every key of the records as a column, with the delimiter", () => {
		const csv = { from: "json", to: "csv" } as const;
		expect(
			write(csv, [
				{ name: "Ann", city: "Oslo" },
				{ name: "Bo, Jr.", tags: ["a", "b"], age: 4 },
			]),
		).toBe('name,city,tags,age\nAnn,Oslo,,\n"Bo, Jr.",,"[""a"",""b""]",4');
		expect(write({ ...csv, delimiter: ";" }, [{ a: "1", b: null }])).toBe(
			"a;b\n1;",
		);
	});

	test("a row with more cells than columns, and data that is not a list of records, are problems", () => {
		expect(
			problem(() =>
				convertValue({ from: "csv", to: "json" }, { text: "a,b\n1,2,3\n" }),
			),
		).toBe(
			"The CSV has more cells in row 2 than columns in its first row. Check the delimiter, or give the extra cells a column.",
		);
		expect(
			problem(() =>
				convertValue({ from: "json", to: "csv" }, { json: { a: 1 } }),
			),
		).toBe(
			'CSV needs a list of records, such as [{"name": "Ann", "city": "Oslo"}].',
		);
	});
});

describe("YAML", () => {
	test("reads any value, and several documents as a list", async () => {
		const yaml = { from: "yaml", to: "json" } as const;
		expect(read(yaml, await fixture("settings.yaml"))).toEqual({
			name: "prices",
			every_minutes: 30,
			sources: [
				{ url: "https://example.com/a", tags: ["shop", "eu"] },
				{ url: "https://example.com/b" },
			],
			notify: true,
			note: "Two lines\nof text\n",
		});
		expect(read(yaml, "a: 1\n---\nb: 2\n")).toEqual([{ a: 1 }, { b: 2 }]);
		expect(problem(() => convertValue(yaml, { text: "a: [1" }))).toStartWith(
			"The YAML is not valid: ",
		);
	});

	test("writes JSON that reads back the same", () => {
		const value = { name: "prices", list: [1, "two", { three: "a: b" }] };
		const text = write({ from: "json", to: "yaml" }, value);
		expect(Bun.YAML.parse(text)).toEqual(value);
	});
});

describe("XML", () => {
	test("reads elements, attributes and repeats, every value as text", async () => {
		expect(
			read({ from: "xml", to: "json" }, await fixture("order.xml")),
		).toEqual({
			order: {
				"@id": "A-1",
				"@status": "open",
				customer: "Ann & Co",
				line: [
					{ "@sku": "007", "#text": "Tea" },
					{ "@sku": "008", "#text": "Cups" },
				],
				total: "012.50",
			},
		});
	});

	test("writes the same shape back, and needs one root", () => {
		const xml = { from: "json", to: "xml" } as const;
		const text = write(xml, {
			note: { "@lang": "en", to: "Ann", line: ["one", "two"] },
		});
		expect(text).toBe(
			'<note lang="en">\n  <to>Ann</to>\n  <line>one</line>\n  <line>two</line>\n</note>\n',
		);
		expect(problem(() => convertValue(xml, { json: { a: 1, b: 2 } }))).toBe(
			'XML needs one root element: a record with one key, such as {"note": {"to": "Ann", "@lang": "en"}}.',
		);
	});

	test("XML that is not well formed is a problem with its line", () => {
		expect(
			problem(() =>
				convertValue({ from: "xml", to: "json" }, { text: "<a>\n<b></a>" }),
			),
		).toStartWith("The XML is not valid on line 2: ");
	});
});

describe("feeds", () => {
	const feed = { from: "feed", to: "json" } as const;

	test("RSS: one fixed item shape, dates as ISO 8601", async () => {
		expect(read(feed, await fixture("news.rss.xml"))).toEqual({
			format: "rss",
			title: "Example news",
			link: "https://example.com/",
			description: "What happened today",
			items: [
				{
					id: "news-1",
					title: "The park opens",
					link: "https://example.com/park",
					summary: "<p>The new park opens on Saturday.</p>",
					content: "<p>The new park opens on <b>Saturday</b>.</p>",
					published: "2026-11-10T08:30:00.000Z",
					updated: "",
					authors: ["Ann Lee"],
					categories: ["city"],
				},
				{
					id: "https://example.com/rates",
					title: "Rates stay the same",
					link: "https://example.com/rates",
					summary: "",
					content: "",
					published: "not a date",
					updated: "",
					authors: [],
					categories: [],
				},
			],
		});
	});

	test("Atom, RDF and JSON Feed read into the same shape", async () => {
		const atom = read(feed, await fixture("news.atom.xml")) as {
			link: string;
			items: unknown[];
		};
		expect(atom.link).toBe("https://example.com/log");
		expect(atom.items[0]).toEqual({
			id: "urn:example:log:2",
			title: "Release 2.0",
			link: "https://example.com/log/2",
			summary: "What is new in 2.0",
			content: "<ul><li>Faster</li></ul>",
			published: "2026-11-09T11:00:00.000Z",
			updated: "2026-11-10T09:00:00.000Z",
			authors: ["Bo"],
			categories: ["Releases"],
		});
		const rdf = read(feed, await fixture("news.rdf.xml")) as {
			format: string;
			items: unknown[];
		};
		expect(rdf.format).toBe("rdf");
		expect(rdf.items[0]).toMatchObject({
			id: "https://example.com/paper/7",
			published: "2026-11-08T00:00:00.000Z",
			authors: ["Cy"],
			categories: ["models"],
		});
		const json = read(feed, await fixture("news.feed.json")) as {
			format: string;
			link: string;
			items: unknown[];
		};
		expect(json.format).toBe("json");
		expect(json.link).toBe("https://example.com/notes");
		expect(json.items[0]).toMatchObject({
			id: "note-3",
			content: "Plain text of the note.",
			categories: ["misc", "ideas"],
		});
	});

	test("a page that is no feed is a problem", () => {
		expect(
			problem(() => convertValue(feed, { text: "<html><body/></html>" })),
		).toBe("The value is not an RSS, Atom or JSON feed.");
	});
});

describe("HTML to text", () => {
	test("keeps headings, paragraphs, lists and link addresses, and drops scripts and styles", async () => {
		const made = convertValue(
			{ from: "html", to: "text" },
			{ text: await fixture("page.html") },
		);
		expect(made).toEqual({
			kind: "text",
			text: "OPENING TIMES\n\nWe open at nine. Read the house rules [https://example.com/rules] first.\n\n * Monday to Friday\n * Saturday until noon",
		});
	});
});

describe("Markdown tables", () => {
	test("reads the first table: a header with a repeat, an escaped pipe, a short row", async () => {
		expect(
			read({ from: "markdown-table", to: "json" }, await fixture("prices.md")),
		).toEqual([
			{ Item: "Tea", Price: "3.50", Item_2: "green" },
			{ Item: "Cups | saucers", Price: "12", Item_2: "" },
		]);
		expect(
			problem(() =>
				convertValue(
					{ from: "markdown-table", to: "json" },
					{ text: "No table here." },
				),
			),
		).toBe(
			"The text has no Markdown table. A table has a header row, then a row such as | --- | --- |.",
		);
	});

	test("writes records as a table that reads back the same", () => {
		const records: JsonValue[] = [
			{ name: "Ann", note: "a | b" },
			{ name: "Bo", note: "two\nlines", age: 4 },
		];
		const text = write({ from: "json", to: "markdown-table" }, records);
		expect(text).toBe(
			"| name | note      | age |\n| ---- | --------- | --- |\n| Ann  | a \\| b    |     |\n| Bo   | two lines | 4   |",
		);
		expect(read({ from: "markdown-table", to: "json" }, text)).toEqual([
			{ name: "Ann", note: "a | b", age: "" },
			{ name: "Bo", note: "two lines", age: "4" },
		]);
		expect(write({ from: "json", to: "markdown-table" }, [])).toBe("");
	});
});
