import { describe, expect, test } from "bun:test";
import { inMemoryReadersPorts } from "../adapters/out/in-memory-neighbours";
import { inMemoryReadMarks } from "../adapters/out/in-memory-read-marks";
import { openStepReader } from "./open-step-reader";

/** The use case openStepReader, on in-memory adapters. The twins of "the step's reader" in `readers.test.ts`. */

const PAGE = "https://example.com/docs/refunds";
const signal = new AbortController().signal;
const noSecret = async () => undefined;

const refunds = {
	title: "Refund policy",
	markdown: "Gift cards are final.",
	links: ["https://example.com/docs/shipping"],
};

describe("openStepReader", () => {
	test("answers a page's file with its status, then unchanged; asked fresh, it reads the page whole", async () => {
		const ports = inMemoryReadersPorts();
		ports.services.local.put(PAGE, refunds);
		const step = await openStepReader(ports)({
			projectId: "p1",
			secret: noSecret,
		});
		expect(await step.read(PAGE, { fresh: false, signal })).toEqual({
			kind: "answer",
			status: "read",
			body: `---\ntitle: "Refund policy"\nsource: ${PAGE}\n---\n\nGift cards are final.\n`,
		});
		expect(await step.links(PAGE)).toEqual([
			"https://example.com/docs/shipping",
		]);
		expect(await step.read(PAGE, { fresh: false, signal })).toEqual({
			kind: "answer",
			status: "unchanged",
			body: "",
		});
		expect(await step.read(PAGE, { fresh: true, signal })).toMatchObject({
			status: "read",
		});
		expect(ports.services.local.asked.map((one) => "before" in one)).toEqual([
			false,
			true,
			false,
		]);
	});

	test("the marks outlive the step: the next step finds the page unchanged, and its links", async () => {
		const ports = inMemoryReadersPorts();
		ports.services.local.put(PAGE, refunds);
		const first = await openStepReader(ports)({
			projectId: "p1",
			secret: noSecret,
		});
		await first.read(PAGE, { fresh: false, signal });
		await first.close();
		expect(ports.marks.flushes).toBe(1);
		const next = await openStepReader({
			...ports,
			marks: inMemoryReadMarks(ports.marks.store),
		})({ projectId: "p1", secret: noSecret });
		expect(await next.read(PAGE, { fresh: false, signal })).toMatchObject({
			status: "unchanged",
		});
		expect(await next.links(PAGE)).toEqual([
			"https://example.com/docs/shipping",
		]);
	});

	test("a page that is gone says so, with why", async () => {
		const ports = inMemoryReadersPorts();
		const step = await openStepReader(ports)({
			projectId: "p1",
			secret: noSecret,
		});
		expect(
			await step.read("https://example.com/gone", { fresh: false, signal }),
		).toEqual({
			kind: "answer",
			status: "gone",
			body: "The page is not there any more.",
		});
		expect(await step.links("https://example.com/gone")).toEqual([]);
	});

	test("a step that gives no web address is refused", async () => {
		const ports = inMemoryReadersPorts();
		const step = await openStepReader(ports)({
			projectId: "p1",
			secret: noSecret,
		});
		expect(await step.read("example.com", { fresh: false, signal })).toEqual({
			kind: "refused",
			reason: "Give the page as url=https://…",
		});
		expect(ports.services.local.asked).toEqual([]);
	});

	test("Night Shift's own reader has no map of a site", async () => {
		const ports = inMemoryReadersPorts();
		const step = await openStepReader(ports)({
			projectId: "p1",
			secret: noSecret,
		});
		expect(
			await step.map("https://example.com/", { limit: null, signal }),
		).toBeNull();
	});

	test("a service reader gets its key from the step's secret, by the setting's name, and maps a site", async () => {
		const ports = inMemoryReadersPorts();
		await (await ports.documents.open("p1")).setReader({
			kind: "firecrawl",
			address: "https://crawl.example",
			secret: "CRAWL_KEY",
		});
		ports.services.firecrawl.mapTo([
			"https://example.com/a",
			"https://example.com/b",
		]);
		const asked: string[] = [];
		const step = await openStepReader(ports)({
			projectId: "p1",
			secret: async (name) => {
				asked.push(name);
				return "secret-value";
			},
		});
		expect(asked).toEqual(["CRAWL_KEY"]);
		expect(ports.services.made).toEqual([
			{
				kind: "firecrawl",
				address: "https://crawl.example",
				key: "secret-value",
			},
		]);
		expect(
			await step.map("https://example.com/", { limit: "1", signal }),
		).toEqual(["https://example.com/a"]);
		expect(await step.map("example.com", { limit: "5", signal })).toBeNull();
		await step.map("https://example.com/", { limit: null, signal });
		await step.map("https://example.com/", { limit: "999999", signal });
		expect(ports.services.firecrawl.maps.map((one) => one.limit)).toEqual([
			1, 100, 5_000,
		]);
	});
});
