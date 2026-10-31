/**
 * Against a real OpenJev server: one decision on its default model. Runs
 * only when `OPENJEV_LIVE_URL` names a server that lists its models, so the
 * default test run asks nothing. A key goes in `OPENJEV_LIVE_KEY`:
 *
 *   OPENJEV_LIVE_URL=http://127.0.0.1:8080 bun test src/decider/openjev.live.test.ts
 */

import { describe, expect, test } from "bun:test";
import { deciderModels, tanstackDecider } from "./decider";

const baseUrl = process.env.OPENJEV_LIVE_URL;
const key = process.env.OPENJEV_LIVE_KEY;
const offered = baseUrl
	? await deciderModels(
			"openjev",
			{},
			{ root: baseUrl.replace(/\/+$/, ""), headers: {}, apiKey: key },
		)
	: null;
const live = offered !== null && offered.listed > 0;

describe.skipIf(!live)(`OpenJev at ${baseUrl}`, () => {
	const decider = tanstackDecider({
		secret: async (name) => (name === "OPENJEV_LIVE_KEY" ? key : undefined),
	});

	test("decides a choice, with its probability", async () => {
		const result = await decider.decide({
			decider: "openjev",
			address: {
				baseUrl: baseUrl as string,
				...(key ? { apiKey: "OPENJEV_LIVE_KEY" } : {}),
			},
			prompt:
				"3 of 214 tests fail and the build is red. Should we ship the release?",
			labels: [
				{ name: "ship", description: "Everything is green, release it" },
				{ name: "hold", description: "Something failed, wait" },
			],
			signal: new AbortController().signal,
		});
		expect(result).toMatchObject({ kind: "decided", label: "hold" });
		expect(result.kind === "decided" && result.probability).toBeGreaterThan(
			0.5,
		);
	}, 120_000);
});
