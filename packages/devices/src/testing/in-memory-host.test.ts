import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { ORPCError } from "@orpc/server";
import type { RunCommand, RunRows } from "../contract";
import { inMemoryHostClient } from "./in-memory-host";
import { type PairedReplicas, pairedReplicas } from "./paired";

/**
 * The Host in memory is the router the API serves (`hostRouter`): the
 * same refusals for a key, the same input checks and errors. It adds
 * values that are copies, and a network that can drop.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	paired = await pairedReplicas(a, b);
});
afterEach(async () => {
	await Promise.all([a.cleanup(), b.cleanup()]);
});

/** The error a call ends in. */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => {
			throw new Error("The call did not fail.");
		},
		(error: unknown) => error,
	);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
	const error = await errorOf(promise);
	expect(error).toBeInstanceOf(ORPCError);
	return (error as ORPCError<string, unknown>).code;
}

/** A run of `walkerId` in A's Space with one event, of a project A lacks unless named. */
function rowsOf(walkerId: string, projectId = "project-none"): RunRows {
	return {
		runs: [
			{
				id: "run-pushed",
				spaceId: a.spaceId,
				projectId,
				flowName: null,
				flow: "{}",
				bodyFlows: "{}",
				flowRevision: null,
				bodyFlowRevisions: "{}",
				title: "Pushed",
				worktreePath: "",
				branch: "nightshift/pushed",
				baseRef: "main",
				walkerId,
				startedBy: null,
				deviceId: null,
				placements: null,
				deviceNames: null,
				createdAt: Date.now(),
			},
		],
		steps: [],
		sessions: [],
		events: [
			{
				spaceId: a.spaceId,
				runId: "run-pushed",
				stepId: null,
				sessionId: null,
				type: "RunStarted",
				payload: "{}",
				at: Date.now(),
				walkerId,
				walkerSeq: 1,
			},
		],
	};
}

describe("a Host in memory", () => {
	test("refuses a key it does not know, and a key without the procedure's group", async () => {
		const { memory, key } = paired;
		let known: typeof key | null = key;
		const client = memory.client(() => known);
		expect(await client.link.hello()).toMatchObject({
			host: { id: paired.hostId },
			deviceId: b.deviceId,
		});

		known = null;
		expect(await codeOf(client.link.heartbeat())).toBe("UNAUTHORIZED");
		const archiveOnly = memory.client({
			...key,
			permissions: { archive: ["put", "get"] },
		});
		expect(await codeOf(archiveOnly.sync.stream({ cursors: {} }))).toBe(
			"FORBIDDEN",
		);
		expect(
			await codeOf(archiveOnly.devices.reachable({ deviceId: a.deviceId })),
		).toBe("FORBIDDEN");
	});

	test("passes the exchange's refusals on, and a refusal as BAD_REQUEST with its words", async () => {
		const client = paired.memory.client(paired.key);
		expect(await codeOf(client.sync.push(rowsOf("someone-else")))).toBe(
			"FORBIDDEN",
		);
		expect(await codeOf(client.sync.push(rowsOf(b.deviceId)))).toBe("CONFLICT");
		const error = await errorOf(
			client.sync.command({
				runId: "run-none",
				kind: "signal.send",
				payload: { name: "go" },
			}),
		);
		expect(error).toBeInstanceOf(ORPCError);
		expect(error).toMatchObject({
			code: "BAD_REQUEST",
			message: "Night Shift cannot find this run.",
		});
		// A batch that is not valid never reaches the exchange.
		const invalid = { ...rowsOf(b.deviceId), events: "none" };
		expect(
			errorOf(client.sync.push(invalid as unknown as RunRows)),
		).resolves.toBeInstanceOf(Error);
	});

	test("down: calls fail as a fetch does and open streams end with an error; up: they work again", async () => {
		const { memory, key } = paired;
		const client = memory.client(key);
		const controller = new AbortController();
		const stream = await client.sync.stream(
			{ cursors: {} },
			{ signal: controller.signal },
		);
		// Nothing new on A: the stream waits.
		const next = stream[Symbol.asyncIterator]().next();

		memory.down();
		expect(await errorOf(next)).toBeInstanceOf(TypeError);
		expect(await errorOf(client.link.heartbeat())).toBeInstanceOf(TypeError);

		memory.up();
		expect(await client.link.heartbeat()).toMatchObject({
			deviceId: b.deviceId,
		});
		// A stream whose call is aborted ends, without an error.
		const again = await client.sync.stream(
			{ cursors: {} },
			{ signal: controller.signal },
		);
		controller.abort();
		const seen: unknown[] = [];
		for await (const batch of again) seen.push(batch);
		expect(seen.length).toBeLessThanOrEqual(1);
	});

	test("checks every input as the API does: defaults fill in, unknown keys go, transforms apply", async () => {
		const seen: { rows?: RunRows; command?: object; clone?: object } = {};
		let running: unknown;
		const client = inMemoryHostClient(
			{
				...paired.hostExchange,
				async push(_key, rows) {
					seen.rows = rows;
					return { events: 0 };
				},
				async command(_key, input) {
					seen.command = input;
				},
				async addClone(_key, input) {
					seen.clone = input;
				},
				work(_key, input) {
					running = input.running;
					return (async function* () {})();
				},
			},
			paired.key,
		);

		// A Device of an older version sends a run without the fields it did
		// not know yet, and one of a newer version a field this Host does not.
		const rows = rowsOf(b.deviceId);
		const [run] = rows.runs;
		if (!run) throw new Error("No run.");
		const { startedBy, deviceId, placements, deviceNames, ...older } = run;
		await client.sync.push({
			...rows,
			runs: [{ ...older, newer: true } as unknown as typeof run],
		});
		expect(seen.rows?.runs).toEqual([
			{
				...older,
				startedBy: null,
				deviceId: null,
				placements: null,
				deviceNames: null,
			},
		]);

		// A command names its run: the Host acts in the key's Person's name,
		// in the run's own Space, never one the Device names.
		const command: RunCommand = {
			id: "command-1",
			spaceId: "another-space",
			runId: "run-1",
			walkerId: b.deviceId,
			personId: "someone-else",
			createdAt: 0,
			kind: "signal.send",
			payload: { name: "go" },
		};
		await client.sync.command(command);
		expect(seen.command).toEqual({
			runId: "run-1",
			kind: "signal.send",
			payload: { name: "go" },
		});

		await client.sync.addClone({
			spaceId: a.spaceId,
			projectId: "project-1",
			deviceName: "  B  ",
		});
		expect(seen.clone).toEqual({
			spaceId: a.spaceId,
			projectId: "project-1",
			deviceName: "B",
		});

		// A Device that serves no calls yet sends no list of them.
		for await (const _ of await client.devices.work()) break;
		expect(running).toEqual([]);
	});

	test("refuses an input the API refuses", async () => {
		const client = paired.memory.client(paired.key);
		expect(
			await codeOf(
				client.sync.command({
					runId: "run-1",
					kind: "gate.resolve",
					payload: { stepId: "step-1", choice: "" },
				}),
			),
		).toBe("BAD_REQUEST");
		const entries = Array.from({ length: 1_001 }, (_, i) => ({
			seq: i + 1,
			stepId: "step-1",
			sessionId: null,
			at: 0,
			event: { type: "text", text: "." },
		}));
		expect(
			await codeOf(
				client.archive.tail({
					step: { spaceId: a.spaceId, runId: "run-1", stepId: "step-1" },
					entries: entries as never,
					ended: false,
				}),
			),
		).toBe("BAD_REQUEST");
	});

	test("gives the Host a copy of what the Device sends, and the Device a copy of the answer", async () => {
		const kept: RunRows[] = [];
		const answer = { events: 1 };
		const client = inMemoryHostClient(
			{
				...paired.hostExchange,
				async push(_key, rows) {
					kept.push(rows);
					return answer;
				},
			},
			paired.key,
		);
		const rows = rowsOf(b.deviceId);
		const got = await client.sync.push(rows);
		expect(got).toEqual(answer);
		expect(got).not.toBe(answer);
		expect(kept).toEqual([rows]);
		expect(kept[0]).not.toBe(rows);
	});
});
