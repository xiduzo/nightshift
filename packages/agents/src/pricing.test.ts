import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { estimateCostUsd, settleCost } from "./pricing";

const usage = { inputTokens: 1_000_000, outputTokens: 100_000 };

describe("settleCost", () => {
	test("the harness's own cost wins", () => {
		expect(
			settleCost({ ...usage, costUsd: 0.42 }, "claude-sonnet-4-6"),
		).toEqual({ costUsd: 0.42, costSource: "reported" });
	});

	test("prices the tokens of a known model", () => {
		// $3 per million input tokens, $15 per million output tokens.
		const settled = settleCost(usage, "claude-sonnet-4-6");
		expect(settled.costSource).toBe("estimated");
		expect(settled.costUsd).toBeCloseTo(4.5, 6);
	});

	test("cache reads cost less than fresh input", () => {
		const fresh = estimateCostUsd(usage, "claude-sonnet-4-6") ?? 0;
		const cached =
			estimateCostUsd(
				{ ...usage, cacheReadTokens: 900_000 },
				"claude-sonnet-4-6",
			) ?? 0;
		expect(cached).toBeLessThan(fresh);
	});

	test("cache writes kept for an hour cost more, as Claude Code reports them", () => {
		// A real Claude Code session: it reported $0.0526781 for these tokens.
		const session = {
			inputTokens: 18 + 41_821 + 23_844,
			outputTokens: 158,
			cacheReadTokens: 41_821,
			cacheWriteTokens: 23_844,
		};
		expect(
			estimateCostUsd(
				{ ...session, cacheWrite1hTokens: 23_844 },
				"claude-haiku-4-5",
			),
		).toBeCloseTo(0.0526781, 7);
		expect(estimateCostUsd(session, "claude-haiku-4-5")).toBeLessThan(0.04);
	});

	test("unknown without usage, without tokens, or without a price", () => {
		const unknown = { costUsd: null, costSource: null };
		expect(settleCost(null, "claude-sonnet-4-6")).toEqual(unknown);
		expect(
			settleCost({ inputTokens: 0, outputTokens: 0 }, "claude-sonnet-4-6"),
		).toEqual(unknown);
		expect(settleCost(usage, null)).toEqual(unknown);
		expect(settleCost(usage, "qwen3-coder:30b")).toEqual(unknown);
	});
});

describe("startPriceUpdates", () => {
	test("fetches once, keeps the list in a file, and survives a broken download", async () => {
		// A new list replaces the bundled one for the whole process: run it apart.
		const child = Bun.spawn(
			[process.execPath, join(import.meta.dir, "fixtures/price-updates.ts")],
			{ stdout: "pipe", stderr: "inherit" },
		);
		const result = JSON.parse(await new Response(child.stdout).text());
		expect(await child.exited).toBe(0);
		expect(result).toEqual({
			kept: true,
			priced: expect.closeTo(1.2, 6),
			// The second ask sends the ETag and gets "not changed".
			requests: [null, '"v1"'],
			errors: 1,
			pricedAfterError: expect.closeTo(1.2, 6),
		});
	});
});
