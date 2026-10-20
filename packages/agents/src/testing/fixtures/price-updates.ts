/**
 * The price-update scenarios of `pricing.test.ts`, in a process of their
 * own: a new list replaces the bundled one for the whole process, and the
 * other test files price with the bundled list. Prints one JSON result.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { settleCost, startPriceUpdates } from "../../pricing/pricing";

const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };
const list = [
	{
		id: "fake",
		name: "Fake",
		api_pattern: "fake\\.test",
		models: [
			{
				id: "fake-model",
				match: { equals: "fake-model" },
				prices: { input_mtok: 1, output_mtok: 2 },
			},
		],
	},
];
const price = () =>
	settleCost(usage, "fake-model", { providerId: "fake" }).costUsd;

// A first start fetches, keeps the list in the file, and prices with it.
const fetched = join(await mkdtemp(join(tmpdir(), "prices-")), "prices.json");
const requests: (string | null)[] = [];
const updates = await startPriceUpdates({
	file: fetched,
	fetch: async (_url, init) => {
		const etag = new Headers(init?.headers).get("if-none-match");
		requests.push(etag);
		return etag === '"v1"'
			? new Response(null, { status: 304 })
			: new Response(JSON.stringify(list), { headers: { etag: '"v1"' } });
	},
});
updates.stop();
const kept = JSON.parse(await readFile(fetched, "utf8"));
const priced = price();
await updates.refresh();

// A broken download keeps the list from the file.
const cached = join(await mkdtemp(join(tmpdir(), "prices-")), "prices.json");
await writeFile(cached, JSON.stringify(list));
const errors: string[] = [];
const broken = await startPriceUpdates({
	file: cached,
	fetch: async () => new Response("not json"),
	onError: (error) => errors.push(String(error)),
});
await broken.refresh();
broken.stop();

console.log(
	JSON.stringify({
		kept: JSON.stringify(kept) === JSON.stringify(list),
		priced,
		requests,
		errors: errors.length,
		pricedAfterError: price(),
	}),
);
