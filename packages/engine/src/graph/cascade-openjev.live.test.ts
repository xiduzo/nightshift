/**
 * A Decision cascade against a real OpenJev server (ADR 6): the first tier
 * asks for more confidence than any pick has, so the second tier decides.
 * Runs only when `OPENJEV_LIVE_URL` names a server, so the default test
 * run asks nothing:
 *
 *   OPENJEV_LIVE_URL=http://127.0.0.1:18080 OPENJEV_LIVE_MODEL=openjev-latest \
 *     bun test src/graph/cascade-openjev.live.test.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tanstackDecider } from "@nightshift/agents";
import type { DecisionNode } from "@nightshift/flows";
import { foldRun } from "../log";
import { deriveSteps } from "../read/run-views";
import { command, drive, flowOf, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

const baseUrl = process.env.OPENJEV_LIVE_URL;
const model = process.env.OPENJEV_LIVE_MODEL ?? "openjev-latest";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe.skipIf(!baseUrl)(`a Decision cascade on OpenJev at ${baseUrl}`, () => {
	test("a pick below the first tier's minimum goes to the next tier, with its probability", async () => {
		const address = { baseUrl: baseUrl as string };
		const node: DecisionNode = {
			id: "release",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt:
				"3 of 214 tests fail and the build is red. Should we ship the release?",
			options: [
				{ name: "ship", description: "Everything is green, release it" },
				{ name: "hold", description: "Something failed, wait" },
			],
			by: "model",
			cascade: [
				{
					label: "picky",
					decider: "openjev",
					model,
					address,
					minConfidence: 1,
				},
				{
					label: "fine",
					decider: "openjev",
					model,
					address,
					minConfidence: 0.5,
				},
			],
		};
		const h = await startRun(
			sandbox,
			flowOf({
				start: "release",
				nodes: [node, command("held", "true"), command("shipped", "true")],
				edges: [
					{ id: "e1", from: "release", outcome: "hold", to: "held" },
					{ id: "e2", from: "release", outcome: "ship", to: "shipped" },
				],
			}),
			{ decider: tanstackDecider({ secret: async () => undefined }) },
		);
		const { state } = await drive(h, { inputs: {} });
		const steps = deriveSteps(foldRun(await h.events())).filter(
			(step) => step.nodeId === "release",
		);
		expect(steps.map((step) => step.outcome)).toEqual(["fail", "hold"]);
		expect(steps[0]?.outputs).toMatchObject({ tier: "picky", pick: "hold" });
		expect(state.nodes.release).toMatchObject({
			outcome: "hold",
			tier: "fine",
			tries: 2,
		});
		expect(state.nodes.release?.confidence).toBeGreaterThan(0.5);
		expect(state.ended?.nodeId).toBe("held");
		console.log(
			"live cascade:",
			steps.map((s) => s.outputs),
		);
	}, 240_000);
});
