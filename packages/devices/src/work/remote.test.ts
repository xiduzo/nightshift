import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRunFolders, type Device } from "@nightshift/engine";
import {
	connectionsOf,
	createSandbox,
	type Sandbox,
	testDevice,
} from "@nightshift/engine/testing";
import {
	UNREADABLE_REQUEST,
	type WorkFor,
	type WorkRelay,
	type WorkRequest,
	workRequestSchema,
} from "../contract";
import { partialHostClient } from "../testing";
import {
	CALL_DEADLINES_MS,
	CLEANUP_WAIT_MS,
	remoteDevice,
	serveWork,
} from "./remote";
import { createWorkServer } from "./work";
import { createWorkHub } from "./work-hub";

/**
 * The snapshots that tell what a step changed, as a Walker asks another
 * Device for them: the call crosses the relay as plain data, and the placed
 * Device answers with its own git. A Device that takes none answers with an
 * error, which the Walker's step runner skips.
 */

const FOR_RUN: WorkFor = {
	spaceId: "space-1",
	projectId: "project-1",
	personId: "person-1",
	runId: "run-1",
};

/** A relay straight to `device`, as the placed Device serves a call. */
function relayTo(device: Device): WorkRelay {
	return {
		call: (_id, request, signal) =>
			serveWork(device, request, signal ?? new AbortController().signal),
		online: () => true,
	};
}

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the snapshots of a remote Device", () => {
	test("tell what changed in its worktree since the first one", async () => {
		const placed = testDevice({ harnesses: {}, snapshots: true });
		const device = remoteDevice(
			relayTo(placed),
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		const cwd = sandbox.repoPath;

		const start = await device.snapshotWorktree?.({ cwd });
		await writeFile(join(cwd, "made-by-a-command.txt"), "hello\n");
		const changes = await device.worktreeChanges?.({
			cwd,
			from: start?.tree ?? "",
		});

		expect(changes?.files).toEqual([
			{
				path: "made-by-a-command.txt",
				status: "added",
				added: 1,
				removed: 0,
				patch: "@@ -0,0 +1 @@\n+hello",
			},
		]);
		expect(changes?.tree).not.toBe(start?.tree);
	});

	test("fail on a Device that takes none", async () => {
		const placed = testDevice({ harnesses: {} });
		const device = remoteDevice(
			relayTo(placed),
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);

		await expect(
			device.snapshotWorktree?.({ cwd: sandbox.repoPath }),
		).rejects.toThrow("does not tell what a step changed");
	});
});

/**
 * A relay that sends each call and reply as JSON, as the Host's hub does,
 * and checks the call as the placed Device reads it.
 */
function wireTo(device: Device): WorkRelay {
	return {
		async *call(_id, request, signal) {
			const sent = JSON.parse(JSON.stringify(request)) as WorkRequest;
			// What the placed Device reads first: a call of a kind it knows.
			const checked = workRequestSchema.safeParse(sent);
			if (!checked.success) throw new Error(checked.error.message);
			for await (const reply of serveWork(
				device,
				sent,
				signal ?? new AbortController().signal,
			)) {
				yield JSON.parse(JSON.stringify(reply));
			}
		},
		online: () => true,
	};
}

describe("a web request on a remote Device", () => {
	test("crosses the wire with its secrets by name, and comes back with their values masked", async () => {
		const seen: string[] = [];
		const server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(request) {
				seen.push(request.headers.get("authorization") ?? "");
				return Response.json({ echo: request.headers.get("authorization") });
			},
		});
		try {
			const placed = testDevice({
				harnesses: {},
				connections: connectionsOf({ secrets: { API_TOKEN: "tok-9" } }),
			});
			const device = remoteDevice(
				wireTo(placed),
				{ id: "laptop", name: "laptop" },
				FOR_RUN,
			);
			const result = await device.request({
				method: "GET",
				url: [{ text: `http://127.0.0.1:${server.port}/items` }],
				headers: [
					{
						name: "Authorization",
						value: [{ text: "Bearer " }, { secret: "API_TOKEN" }],
					},
				],
				timeoutMs: 5_000,
				maxBytes: 1_024,
				signal: new AbortController().signal,
			});
			expect(seen).toEqual(["Bearer tok-9"]);
			expect(result).toMatchObject({
				kind: "answered",
				response: { status: 200, body: { echo: "Bearer •••" } },
			});
		} finally {
			server.stop(true);
		}
	});

	test("a Device of an older Night Shift says to update it", async () => {
		const older: WorkRelay = {
			async *call() {
				yield { kind: "error", message: UNREADABLE_REQUEST };
			},
			online: () => true,
		};
		const device = remoteDevice(
			older,
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		expect(
			await device.request({
				method: "GET",
				url: [{ text: "https://api.example.com" }],
				timeoutMs: 1_000,
				maxBytes: 1_024,
				signal: new AbortController().signal,
			}),
		).toEqual({
			kind: "refused",
			message:
				"laptop runs an older version of Night Shift. Update Night Shift on laptop.",
		});
	});

	test("a Device that cannot answer is a network failure", async () => {
		const gone: WorkRelay = {
			async *call() {},
			online: () => true,
		};
		const device = remoteDevice(
			gone,
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		expect(
			await device.request({
				method: "GET",
				url: [{ text: "https://api.example.com" }],
				timeoutMs: 1_000,
				maxBytes: 1_024,
				signal: new AbortController().signal,
			}),
		).toEqual({
			kind: "failed",
			message: "laptop stopped answering before the step ended.",
			network: true,
		});
	});
});

describe("a call to a remote Device that never answers", () => {
	test("ends with a refusal after its deadline, and the call is cancelled there", async () => {
		const before = CALL_DEADLINES_MS.capabilities;
		CALL_DEADLINES_MS.capabilities = 30;
		let cancelled = false;
		// The call went to a stream nobody reads: no reply ever comes.
		const lost: WorkRelay = {
			async *call(_id, _request, signal) {
				await new Promise<void>((resolve) =>
					signal?.addEventListener("abort", () => resolve(), { once: true }),
				);
				cancelled = signal?.aborted === true;
			},
			online: () => true,
		};
		try {
			const device = remoteDevice(
				lost,
				{ id: "laptop", name: "laptop" },
				FOR_RUN,
			);
			await expect(device.capabilities()).rejects.toThrow(
				"laptop did not answer in time. Check that it is online, then try again.",
			);
			expect(cancelled).toBe(true);
		} finally {
			CALL_DEADLINES_MS.capabilities = before;
		}
	});
});

describe("the run folder of a remote Device", () => {
	test("is made there once, with no branch and no base", async () => {
		const folders = createRunFolders(sandbox.dataDir);
		const placed = testDevice({ harnesses: {}, runFolders: folders });
		const device = remoteDevice(
			relayTo(placed),
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		const run = { id: "run-1", projectId: "project-1" };
		expect(await device.runFolder?.(run)).toEqual({
			worktreePath: folders.path("run-1"),
			branch: "",
			baseRef: "",
			made: true,
		});
		expect(existsSync(folders.path("run-1"))).toBe(true);
		expect((await device.runFolder?.(run))?.made).toBe(false);
	});

	test("on a Device that makes none, or of an older Night Shift, says to update it", async () => {
		const run = { id: "run-1", projectId: "project-1" };
		// The placed Device names itself: the test's is "test".
		const none = remoteDevice(
			relayTo(testDevice({ harnesses: {} })),
			{ id: "test", name: "test" },
			FOR_RUN,
		);
		const older = remoteDevice(
			{
				async *call() {
					// What an older Device answers to a call it cannot read.
					yield { kind: "error", message: UNREADABLE_REQUEST };
				},
				online: () => true,
			},
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		for (const device of [none, older]) {
			await expect(device.runFolder?.(run)).rejects.toThrow(
				`Update Night Shift on ${device.name} to run projects without a folder.`,
			);
		}
	});
});

/** One turn of the event loop, as a cleanup that removes files takes. */
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A Host's hub, and a placed Device that serves `device` through it as the
 * daemon does: its work server takes the calls over its link and sends the
 * replies back, a batch at a time. `cancelled`: the calls the Host
 * cancelled there.
 */
async function placedOn(device: Device) {
	const back = Promise.withResolvers<void>();
	const hub = createWorkHub({ onBack: () => back.resolve() });
	const client = partialHostClient({
		devices: {
			work: async (input, options) =>
				hub.take("laptop", options?.signal as AbortSignal, input?.running),
			workReply: async (input) => ({ known: hub.reply("laptop", input) }),
		},
	});
	const cancelled: string[] = [];
	const server = createWorkServer({
		serve: (request, signal) => {
			signal.addEventListener("abort", () => cancelled.push(request.call.kind));
			return serveWork(device, request, signal);
		},
	});
	const closed = new AbortController();
	const detach = server.attach({
		stream(_name, open) {
			void open(client, closed.signal);
			return () => closed.abort();
		},
		ready: async () => client,
	});
	await back.promise;
	return { hub, cancelled, detach };
}

/** The Walker's cleanup wait, which ends when the test says. */
function heldPause() {
	const asked = Promise.withResolvers<number>();
	let end = () => {};
	return {
		/** How long the Walker would wait. */
		asked: asked.promise,
		end: () => end(),
		pause: (ms: number, signal?: AbortSignal) =>
			new Promise<void>((resolve) => {
				end = resolve;
				signal?.addEventListener("abort", () => resolve(), { once: true });
				asked.resolve(ms);
			}),
	};
}

const SESSION = {
	cwd: "/work",
	prompt: "Do the work.",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
} as const;

/** A placed Device whose session ends, then cleans up as `cleanup` says. */
function sessionDevice(cleanup: () => Promise<void>): Device {
	return {
		id: "laptop",
		name: "laptop",
		async *session() {
			try {
				yield { type: "ready", harness: "claude-code" };
				yield { type: "finished" };
			} finally {
				await cleanup();
			}
		},
	} as unknown as Device;
}

/** A step's read of a session: up to its last event. */
async function readSession(
	device: Device,
	signal: AbortSignal,
	order: string[],
) {
	for await (const event of device.session({ ...SESSION, signal })) {
		order.push(event.type);
		if (event.type === "finished") break;
	}
	order.push("step ended");
}

describe("a session or a command on a remote Device", () => {
	test("a session ends after the Device's cleanup there, and its call is not cancelled", async () => {
		const order: string[] = [];
		const placed = await placedOn(
			sessionDevice(async () => {
				// The knowledge goes to the Space, the harness's files go.
				await turn();
				order.push("cleanup");
			}),
		);
		const walker = remoteDevice(
			placed.hub,
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		await readSession(walker, new AbortController().signal, order);
		expect(order).toEqual(["ready", "finished", "cleanup", "step ended"]);
		expect(placed.cancelled).toEqual([]);
		placed.detach();
	});

	test("a command ends after the Device's cleanup there, and its call is not cancelled", async () => {
		const order: string[] = [];
		const device = {
			id: "laptop",
			name: "laptop",
			async *exec() {
				try {
					yield { type: "output", stream: "stdout", text: "synced\n" };
					yield { type: "exit", exitCode: 0, spawnError: null };
				} finally {
					// A sync's files go to the Space.
					await turn();
					order.push("cleanup");
				}
			},
		} as unknown as Device;
		const placed = await placedOn(device);
		const walker = remoteDevice(
			placed.hub,
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
		);
		// As `runCommand` reads it: up to its exit.
		for await (const event of walker.exec({
			command: "sync",
			cwd: "/work",
			signal: new AbortController().signal,
		})) {
			order.push(event.type);
			if (event.type === "exit") break;
		}
		order.push("step ended");
		expect(order).toEqual(["output", "exit", "cleanup", "step ended"]);
		expect(placed.cancelled).toEqual([]);
		placed.detach();
	});

	test("a Device that does not end its call holds the step for the cleanup wait only, then the call stops there", async () => {
		const order: string[] = [];
		// A cleanup that hangs, or a Device that went away during it.
		const placed = await placedOn(sessionDevice(() => new Promise(() => {})));
		const held = heldPause();
		const walker = remoteDevice(
			placed.hub,
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
			{ pause: held.pause },
		);
		const reading = readSession(walker, new AbortController().signal, order);
		expect(await held.asked).toBe(CLEANUP_WAIT_MS);
		expect(order).toEqual(["ready", "finished"]);
		held.end();
		await reading;
		expect(order).toEqual(["ready", "finished", "step ended"]);
		// As without the wait: the call is cancelled there.
		expect(placed.cancelled).toEqual(["session"]);
		placed.detach();
	});

	test("a stop during the Device's cleanup ends the step at once", async () => {
		const order: string[] = [];
		const placed = await placedOn(sessionDevice(() => new Promise(() => {})));
		const held = heldPause();
		const walker = remoteDevice(
			placed.hub,
			{ id: "laptop", name: "laptop" },
			FOR_RUN,
			{ pause: held.pause },
		);
		const stop = new AbortController();
		const reading = readSession(walker, stop.signal, order);
		await held.asked;
		stop.abort();
		await reading;
		expect(order).toEqual(["ready", "finished", "step ended"]);
		expect(placed.cancelled).toEqual(["session"]);
		placed.detach();
	});
});
