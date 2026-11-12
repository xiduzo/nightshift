import { describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import type { Relay } from "../contract";
import { createRunRelay, TEST_RUN_ON_HOST } from "./relay";

/** The start of a run on the Host that keeps the Space (`startOnHost`). */

describe("a start on the Host", () => {
	test("refuses a test run: the Host would drop its pins and skips and run every node (ADR 27)", async () => {
		let asked = 0;
		const relay = createRunRelay({
			db: {} as Database,
			log: { events: async () => [] },
			relay: {
				startRun: async () => {
					asked += 1;
					return { runId: "run-1" };
				},
			} as unknown as Relay,
			now: () => 0,
			listRuns: async () => [],
		});
		await expect(
			relay.startOnHost(
				{
					projectId: "p1",
					flowName: "watch",
					test: { skipped: { approve: "send" } },
				},
				"space-team",
			),
		).rejects.toThrow(TEST_RUN_ON_HOST);
		expect(asked).toBe(0);
	});
});
