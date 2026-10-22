import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox, type Sandbox } from "@nightshift/engine/testing";
import { ORPCError } from "@orpc/server";
import type { RunRows } from "../contract";
import { inMemoryHostClient } from "./in-memory-host";
import { type PairedReplicas, pairedReplicas } from "./paired";

/**
 * The Host in memory answers a Device as the API's router does: the same
 * refusals for a key, the same errors, values that are copies, and a
 * network that can drop.
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
				title: "Pushed",
				worktreePath: "",
				branch: "nightshift/pushed",
				baseRef: "main",
				walkerId,
				startedBy: null,
				deviceId: null,
				placements: null,
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

	test("passes the exchange's refusals on, and a plain error as BAD_REQUEST", async () => {
		const client = paired.memory.client(paired.key);
		expect(await codeOf(client.sync.push(rowsOf("someone-else")))).toBe(
			"FORBIDDEN",
		);
		expect(await codeOf(client.sync.push(rowsOf(b.deviceId)))).toBe("CONFLICT");
		const error = await errorOf(
			client.sync.command({
				runId: "run-none",
				spaceId: a.spaceId,
				kind: "signal.send",
				payload: { name: "go" },
			}),
		);
		expect(error).toBeInstanceOf(ORPCError);
		expect(error).toMatchObject({
			code: "BAD_REQUEST",
			message: "Run not found: run-none",
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
