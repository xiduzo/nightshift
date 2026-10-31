import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EndNode } from "@nightshift/flows";
import { foldRun } from "../log";

import { readTranscriptFile } from "../log/transcripts";
import { deriveRunState, deriveSteps } from "../read/run-views";
import {
	command,
	drive,
	edge,
	flowOf,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { endingOf } from "./thread";

/**
 * The End node on the compiled graph: a chosen end with a result. The run
 * ends with the End's status as its result and its message as its reason;
 * a `failed` End ends the run `failed`. In a called flow, the Call reads
 * the result: `pass` or `fail`, with `ended` and `end_message`.
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const end = (
	id: string,
	status: EndNode["status"],
	message?: string,
): EndNode => ({
	id,
	type: "end",
	position: { x: 0, y: 0 },
	status,
	...(message !== undefined ? { message } : {}),
});

/** look (pass → none: nothing to do; fail → broke: failed). */
const lookFlow = (cmd: string) =>
	flowOf(
		[
			command("look", cmd),
			end("none", "nothing-to-do", "  No open issues for {{label}}\nmore"),
			end("broke", "failed"),
		],
		[edge("e1", "look", "pass", "none"), edge("e2", "look", "fail", "broke")],
		{ inputs: [{ name: "label", type: "text", default: "bugs" }] },
	);

describe("the End node", () => {
	test("ends the run with its status as the result and its message, on one line, as the reason", async () => {
		const h = await startRun(sandbox, lookFlow("true"));
		const driven = await drive(h, { inputs: { label: "bugs" } });
		expect(driven.parked).toEqual([]);
		expect(driven.state.ended).toEqual({
			status: "finished",
			nodeId: "none",
			outcome: "nothing-to-do",
			reason: "No open issues for bugs",
			result: "nothing-to-do",
		});
		expect(driven.state.nodes.none).toEqual({
			message: "No open issues for bugs",
			visit: 1,
			outcome: "nothing-to-do",
		});
		// What the runner appends for it.
		expect(endingOf(driven.outcome)).toEqual({
			status: "finished",
			reason: "No open issues for bugs",
			result: "nothing-to-do",
		});

		const events = await h.events();
		expect(payloads(events, "StepStarted").map((p) => p.nodeType)).toEqual([
			"command",
			"end",
		]);
		const endStep = deriveSteps(foldRun(events)).find(
			(s) => s.nodeId === "none",
		);
		expect(endStep?.outcome).toBe("nothing-to-do");
		expect(
			(await readTranscriptFile(endStep?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "end",
				status: "nothing-to-do",
				message: "No open issues for bugs",
			},
		]);
	});

	test("a failed End ends the run failed: a failure its flow chose, with no message", async () => {
		const h = await startRun(sandbox, lookFlow("false"));
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.ended).toMatchObject({
			nodeId: "broke",
			outcome: "failed",
			reason: null,
			result: "failed",
		});
		const ending = endingOf(driven.outcome);
		expect(ending).toEqual({
			status: "failed",
			reason: null,
			result: "failed",
		});
		// As the runner logs it, the run reads as failed with its result.
		await h.log.append({
			type: "RunEnded",
			runId: h.runId,
			payload: {
				status: "failed",
				reason: null,
				result: "failed",
			},
		});
		expect(deriveRunState(foldRun(await h.events()))).toEqual({
			status: "failed",
			reason: null,
			result: "failed",
		});
	});
});

describe("an End node in a called flow", () => {
	const callOnce = (id: string, flow: string) =>
		({ id, type: "call", position: { x: 0, y: 0 }, flow, inputs: {} }) as const;
	const report = command(
		"report",
		'echo "{{sub.outcome}}|{{sub.ended}}|{{sub.end_message}}"',
	);

	test("done and nothing-to-do end the Call pass, with the status as ended and the message as end_message", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[callOnce("sub", "look"), report],
				[edge("e1", "sub", "pass", "report")],
			),
			{ flows: { look: lookFlow("true") } },
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.sub).toMatchObject({
			outcome: "pass",
			ended: "nothing-to-do",
			end_message: "No open issues for bugs",
		});
		expect(driven.state.nodes.report).toMatchObject({
			log_tail: "pass|nothing-to-do|No open issues for bugs",
		});
		// The run itself ends plainly: only an End of its own flow gives it a result.
		expect(driven.state.ended).toEqual({
			status: "finished",
			nodeId: "report",
			outcome: "pass",
			reason: null,
		});
	});

	test("a failed End ends the Call fail, and the run goes on along its fail edge", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[callOnce("sub", "look"), report],
				[edge("e1", "sub", "fail", "report")],
			),
			{ flows: { look: lookFlow("false") } },
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.sub).toMatchObject({
			outcome: "fail",
			ended: "failed",
			end_message: "",
		});
		const sub = deriveSteps(foldRun(await h.events())).find(
			(s) => s.nodeId === "sub",
		);
		expect(sub?.error).toBe('The flow ended as failed at node "broke".');
		expect(driven.state.nodes.report).toMatchObject({
			log_tail: "fail|failed|",
		});
	});

	test("in a Call with each, a failed End fails the element and the others go on", async () => {
		const h = await startRun(
			sandbox,
			flowOf([
				{
					id: "all",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "pick",
					inputs: {},
					each: {
						source: { kind: "json", value: '["a","b"]' },
						as: "item",
						branch: "shared",
					},
				},
			]),
			{
				flows: {
					pick: flowOf(
						[
							{
								id: "which",
								type: "decision",
								position: { x: 0, y: 0 },
								by: "rule",
								prompt: "",
								options: [
									{ name: "bad", when: 'item = "a"' },
									{ name: "good" },
								],
							},
							end("no", "failed", "Item {{item}} is bad"),
							end("yes", "done"),
						],
						[
							edge("p1", "which", "bad", "no"),
							edge("p2", "which", "good", "yes"),
						],
						{ inputs: [{ name: "item", type: "json" }] },
					),
				},
			},
		);
		const driven = await drive(h, { inputs: {} });
		expect(driven.state.nodes.all).toMatchObject({
			outcome: "done",
			done_count: 1,
			failed_count: 1,
		});
		expect(
			payloads(await h.events(), "ItemEnded").map((p) => [p.state, p.reason]),
		).toEqual([
			["failed", "Item a is bad"],
			["done", null],
		]);
	});
});
