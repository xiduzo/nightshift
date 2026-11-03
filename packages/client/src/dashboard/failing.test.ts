import { describe, expect, test } from "bun:test";

import { shortReason } from "./failing";

describe("shortReason", () => {
	test("take the step out and keep the first sentence", () => {
		expect(
			shortReason(
				'Node "agent_view" failed: The command needs the secret LAB_DB_URL. Add it on the Secrets page.',
			),
		).toEqual({
			step: "agent_view",
			short: "The command needs the secret LAB_DB_URL.",
		});
	});

	test("keep a node outcome as a sentence", () => {
		expect(
			shortReason('Node "write" ended with "failed" and no edge leaves it.'),
		).toEqual({
			step: "write",
			short: 'ended with "failed" and no edge leaves it.',
		});
	});

	test("cut the output a reason carries", () => {
		expect(
			shortReason('The Mac cannot reach the database: | 84 | """Who we are'),
		).toEqual({ step: null, short: "The Mac cannot reach the database" });
		expect(shortReason("Tests failed\n  at foo.ts:12")).toEqual({
			step: null,
			short: "Tests failed",
		});
	});

	test("give no short reason for none", () => {
		expect(shortReason(null)).toEqual({ step: null, short: null });
		expect(shortReason("  ")).toEqual({ step: null, short: null });
	});
});
