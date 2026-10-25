import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type FakeHarness, fakeHarness } from "@nightshift/agents/testing";
import {
	event,
	member,
	organization,
	project,
	runCommand,
	run as runTable,
	user,
} from "@nightshift/db/schema";
import type { RunStatus, RunStreamItem } from "@nightshift/engine";
import {
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import type { HostClient } from "../contract";
import { onReplyMismatch, type ReplyMismatch } from "../contract/described";
import type { Link } from "../links";
import { httpsLink } from "../links/link";
import type { PeerEngine } from "../peers";
import { type PairedReplicas, pairedReplicas } from "../testing";
import { createDeviceExchange, type DeviceExchange } from "./device-exchange";

/**
 * The Device's exchange with its Host, in one process: B (the Device)
 * runs its real exchange over a real Link to A (the Host) in memory.
 * `memory.down()` is the network gone: the link goes offline, and comes
 * back by itself after `memory.up()`. Every reply of the Host matches
 * its schema in the contract.
 */

let a: Sandbox;
let b: Sandbox;
let paired: PairedReplicas;
/** The agent of both Replicas: a first session that writes, then waits; then one that ends. */
let agent: FakeHarness;
let projectId: string;
let exchange: DeviceExchange;
/** The links still open: closed after each test. */
let periods: { stop(): Promise<void> }[];
/** More Replicas a test paired with A: removed after its links. */
let others: Sandbox[];
/** The Host's replies that did not match their schemas. */
let mismatches: ReplyMismatch[];
let restoreReplies: () => void;

beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
	agent = fakeHarness((_input, call) =>
		call === 0
			? {
					steps: [
						{ type: "text", text: "first part", chunkSize: 100 },
						{ type: "wait", ms: 60_000 },
					],
				}
			: { steps: [{ type: "text", text: "second part", chunkSize: 100 }] },
	);
	paired = await pairedReplicas(a, b, {
		harnesses: { "claude-code": agent },
	});
	projectId = (
		await paired.host.space(a.spaceId).addProject({ repoPath: a.repoPath })
	).id;
	exchange = deviceExchange();
	periods = [];
	others = [];
	mismatches = [];
	restoreReplies = onReplyMismatch((mismatch) => mismatches.push(mismatch));
});
afterEach(async () => {
	for (const period of periods) await period.stop();
	restoreReplies();
	await Promise.all([a, b, ...others].map((s) => s.cleanup()));
	expect(mismatches).toEqual([]);
});

function deviceExchange(
	engine: PeerEngine = paired.device,
	selfId: string = b.deviceId,
): DeviceExchange {
	return createDeviceExchange({
		engine,
		hostId: paired.hostId,
		selfId,
		projectWaitMs: 5_000,
		idleMs: 1_000,
	});
}

/** B's link to A over `client`, with the exchange attached (B's by default), until `stop`. */
function online(
	client: HostClient = paired.memory.client(paired.key),
	on: DeviceExchange = exchange,
) {
	const link = httpsLink({
		link: {
			hostId: paired.hostId,
			name: "A",
			addresses: ["memory"],
			certificate: null,
			fingerprint: null,
			role: "guest",
			personId: paired.personId,
			keyStore: "file",
			createdAt: 0,
			revokedAt: null,
		},
		key: "memory",
		clientFor: () => client,
		heartbeatMs: 20,
		firstBackoffMs: 5,
		maxBackoffMs: 20,
		streamBackoff: { firstMs: 5, maxMs: 20 },
	});
	const detach = on.attach(link);
	const period = {
		link,
		async stop() {
			detach();
			await link.close();
		},
	};
	periods.push(period);
	return period;
}

const status = (period: { link: Link }) => period.link.state().status;

/** A command, then a Gate. */
const gateFlow = {
	version: 5,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello",
			output: "text",
		},
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "approve" }, { name: "reject" }],
			by: "person",
			decider: "typesafe",
		},
	],
	edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
} as Flow;

/** One Agent step. */
const agentFlow = {
	version: 5,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "agent",
			position: { x: 0, y: 0 },
			prompt: "Work.",
			harness: "claude-code",
			model: "sonnet",
			permissionMode: "acceptEdits",
			session: "fresh",
		},
	],
	edges: [],
} as Flow;

/** One command step: a run that ends on its own. */
const quickFlow = {
	version: 5,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo while the Host was away",
			output: "text",
		},
	],
	edges: [],
} as Flow;

/** A For Each over three items; its body (`say`, in the folder at `repoPath`) prints the item. */
async function forEachFlow(repoPath: string): Promise<Flow> {
	const flows = join(repoPath, ".nightshift", "flows");
	await mkdir(flows, { recursive: true });
	await writeFile(
		join(flows, "say.json"),
		JSON.stringify({
			version: 5,
			inputs: [{ name: "item", type: "json", required: true }],
			outputs: [],
			start: "say",
			nodes: [
				{
					id: "say",
					type: "command",
					position: { x: 0, y: 0 },
					command: "echo item {{item.id}}",
					output: "text",
				},
			],
			edges: [],
		}),
	);
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: "loop",
		nodes: [
			{
				id: "loop",
				type: "call",
				position: { x: 0, y: 0 },
				flow: "say",
				inputs: {},
				each: {
					source: {
						kind: "command",
						command: `printf '%s' '[{"id":"1"},{"id":"2"},{"id":"3"}]'`,
					},
					as: "item",
					branch: "shared",
					haltOn: ["halt"],
				},
			},
		],
		edges: [],
	} as Flow;
}

/** One command that prints, waits for a file, and prints again. */
function slowFlow(marker: string): Flow {
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: "build",
		nodes: [
			{
				id: "build",
				type: "command",
				position: { x: 0, y: 0 },
				command: `echo first; while [ ! -f '${marker}' ]; do sleep 0.05; done; echo second`,
				output: "text",
			},
		],
		edges: [],
	} as Flow;
}

async function statusOn(engine: PeerEngine, runId: string) {
	try {
		return (await engine.space(a.spaceId).getRun(runId)).status;
	} catch {
		return null;
	}
}

function untilStatus(engine: PeerEngine, runId: string, status: RunStatus) {
	return waitFor(async () => (await statusOn(engine, runId)) === status, {
		label: `status ${status}`,
		timeoutMs: 15_000,
	});
}

/** The run's events on a Replica, in its Walker's order. */
async function eventsOf(sandbox: Sandbox, runId: string) {
	return (await sandbox.db.select().from(event).where(eq(event.runId, runId)))
		.map((e) => [e.walkerId, e.walkerSeq, e.type] as const)
		.sort((x, y) => (x[1] ?? 0) - (y[1] ?? 0));
}

/** B walks a run of A's project in A's Space. */
async function walkOnB(flow: Flow) {
	await paired.projectOnDevice(projectId, { clone: true });
	return paired.device.space(a.spaceId).startRun({ projectId, flow });
}

/** What A recorded of a command: done, and why not. */
async function commandOnA(id: string) {
	const [row] = await a.db
		.select()
		.from(runCommand)
		.where(eq(runCommand.id, id));
	return { done: row?.doneAt != null, error: row?.error ?? null };
}

/** A client whose calls go through `wrap` first. */
function withSync(
	client: HostClient,
	sync: Partial<HostClient["sync"]>,
): HostClient {
	return { ...client, sync: { ...client.sync, ...sync } };
}

const outputOf = (items: RunStreamItem[]) =>
	items.flatMap((item) =>
		item.kind === "transcript" && item.entry.event.type === "command-output"
			? [item.entry.event.text.trim()]
			: [],
	);

/** The text of a step's transcript entries in `items`. */
const textOf = (items: RunStreamItem[], stepId: string) =>
	items
		.flatMap((item) =>
			item.kind === "transcript" && item.entry.stepId === stepId
				? [JSON.stringify(item.entry.event)]
				: [],
		)
		.join("\n");

/** Watches a run on `engine` in the background: every item it streams. */
function watchItems(engine: PeerEngine, runId: string) {
	const controller = new AbortController();
	const items: RunStreamItem[] = [];
	const done = (async () => {
		for await (const item of engine
			.space(a.spaceId)
			.watchRun(runId, { signal: controller.signal })) {
			items.push(item);
		}
	})().catch(() => {});
	return {
		items,
		async stop() {
			controller.abort();
			await done;
		},
	};
}

/** Watches a run on `engine` in the background: its transcript entries. */
function watch(engine: PeerEngine, runId: string, afterSeq?: number) {
	const controller = new AbortController();
	const items: RunStreamItem[] = [];
	const done = (async () => {
		for await (const item of engine.space(a.spaceId).watchRun(runId, {
			signal: controller.signal,
			...(afterSeq === undefined ? {} : { afterSeq }),
		})) {
			items.push(item);
		}
	})().catch(() => {});
	const seqs = () =>
		items.flatMap((item) =>
			item.kind === "transcript" ? [item.entry.seq] : [],
		);
	return {
		lines: () => outputOf(items),
		seqs,
		async stop() {
			controller.abort();
			await done;
		},
	};
}

describe("the Device's exchange with its Host", () => {
	test("B's run lands on A by cursor, once, with its ended step's files and walk state in A's archive", async () => {
		const run = await walkOnB(quickFlow);
		online();
		await untilStatus(paired.host, run.id, "finished");
		await untilStatus(paired.device, run.id, "finished");

		const onA = await waitFor(async () => {
			const events = await eventsOf(a, run.id);
			return events.length === (await eventsOf(b, run.id)).length && events;
		});
		expect(onA).toEqual(await eventsOf(b, run.id));
		expect(new Set(onA.map((e) => e[1])).size).toBe(onA.length);

		const [step] = (await paired.device.space(a.spaceId).getRun(run.id)).steps;
		const ref = {
			spaceId: a.spaceId,
			runId: run.id,
			stepId: step?.id as string,
		};
		const archived = (kind: "transcript" | "log" | "checkpoint") =>
			paired.hostExchange.archiveGet(
				paired.key,
				kind === "checkpoint"
					? { kind, spaceId: a.spaceId, runId: run.id }
					: { kind, ...ref },
			);
		await waitFor(async () => (await archived("checkpoint")) !== null, {
			label: "the walk state on A",
		});
		expect(await archived("transcript")).toContain("while the Host was away");
		expect(await archived("log")).not.toBeNull();
	});

	test("A's run lands on B; a batch whose project B lacks waits for it, and starts again from the same cursor", async () => {
		exchange = createDeviceExchange({
			engine: paired.device,
			hostId: paired.hostId,
			selfId: b.deviceId,
			projectWaitMs: 50,
		});
		const run = await paired.host
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(paired.host, run.id, "waiting");

		const client = paired.memory.client(paired.key);
		let streams = 0;
		online(
			withSync(client, {
				stream: (input, options) => {
					streams++;
					return client.sync.stream(input, options);
				},
			}),
		);
		// Past the wait: the stream starts again, the cursor did not move.
		await waitFor(() => streams >= 3, { label: "a stream again" });
		expect(
			await paired.device.exchange.rows.cursorsWith(paired.hostId),
		).toEqual({});
		expect(await statusOn(paired.device, run.id)).toBeNull();

		// The Space document brings the project: the run lands.
		await paired.projectOnDevice(projectId);
		await untilStatus(paired.device, run.id, "waiting");
		expect(await eventsOf(b, run.id)).toEqual(await eventsOf(a, run.id));
	});

	test("a Gate answered on A travels to B as a Command; B applies it and the run finishes on both", async () => {
		const run = await walkOnB(gateFlow);
		online();
		await untilStatus(paired.host, run.id, "waiting");
		const gate = (await paired.host.space(a.spaceId).listGates())[0];
		expect(gate?.walker.id).toBe(b.deviceId);

		await paired.host
			.space(a.spaceId, { personId: paired.personId })
			.resolveGate({
				runId: run.id,
				stepId: gate?.stepId as string,
				choice: "approve",
			});
		await untilStatus(paired.device, run.id, "finished");
		await untilStatus(paired.host, run.id, "finished");
		expect(await paired.host.exchange.commands.pendingOf(run.id)).toEqual([]);
	});

	test("a Command applied just before the link dropped is not applied again when it is back", async () => {
		const run = await walkOnB(gateFlow);
		// The link drops after B applied the answer, before A heard so.
		const client = paired.memory.client(paired.key);
		const reported: (string | null)[] = [];
		let dropped = false;
		const period = online(
			withSync(client, {
				commandDone: async (input, options) => {
					if (!dropped) {
						dropped = true;
						paired.memory.down();
						throw new TypeError("The network connection was lost.");
					}
					reported.push(input.error);
					return client.sync.commandDone(input, options);
				},
			}),
		);
		await untilStatus(paired.host, run.id, "waiting");
		const gate = (await paired.host.space(a.spaceId).listGates())[0];
		await paired.host
			.space(a.spaceId, { personId: paired.personId })
			.resolveGate({
				runId: run.id,
				stepId: gate?.stepId as string,
				choice: "approve",
			});
		const [command] = await paired.host.exchange.commands.pendingOf(run.id);
		await waitFor(() => dropped && status(period) === "offline", {
			label: "the link to drop",
		});
		await untilStatus(paired.device, run.id, "finished");
		expect((await commandOnA(command?.id as string)).done).toBe(false);

		// Back online: A sends the Command again; B reports its first result.
		paired.memory.up();
		await waitFor(async () => (await commandOnA(command?.id as string)).done, {
			label: "the Command done on A",
		});
		expect(await commandOnA(command?.id as string)).toEqual({
			done: true,
			error: null,
		});
		expect(reported).toEqual([null]);
		await untilStatus(paired.host, run.id, "finished");
	});

	test("B refuses a Command for a run it does not walk, or from a role that does not allow it; A records why", async () => {
		const run = await walkOnB(gateFlow);
		online();
		await untilStatus(paired.host, run.id, "waiting");
		const document = await paired.documents.open(a.spaceId);
		document.doc.transact(() => {
			document.members.set("viewer", { name: "Viewer", role: "viewer" });
		});
		const gate = (await paired.host.space(a.spaceId).listGates())[0];
		const { commands } = paired.host.exchange;
		const elsewhere = await commands.enqueue({
			kind: "signal.send",
			payload: { name: "go" },
			spaceId: a.spaceId,
			runId: "run-elsewhere",
			walkerId: b.deviceId,
			personId: paired.personId,
		});
		const viewer = await commands.enqueue({
			kind: "gate.resolve",
			payload: { stepId: gate?.stepId as string, choice: "approve" },
			spaceId: a.spaceId,
			runId: run.id,
			walkerId: b.deviceId,
			personId: "viewer",
		});

		await waitFor(async () => (await commandOnA(viewer.id)).done, {
			label: "both Commands done",
		});
		await waitFor(async () => (await commandOnA(elsewhere.id)).done);
		expect(await commandOnA(elsewhere.id)).toEqual({
			done: true,
			error: "This device does not run this run.",
		});
		expect(await commandOnA(viewer.id)).toEqual({
			done: true,
			error: "The person who asked may not do this in this Space.",
		});
		expect(await statusOn(paired.device, run.id)).toBe("waiting");
	});

	test("B keeps walking while A is away, and A catches up from the cursor when the link is back", async () => {
		const before = await walkOnB(quickFlow);
		const period = online();
		await untilStatus(paired.host, before.id, "finished");
		await waitFor(
			async () =>
				(await eventsOf(a, before.id)).length ===
				(await eventsOf(b, before.id)).length,
		);
		paired.memory.down();
		await waitFor(() => status(period) === "offline", {
			label: "the link offline",
		});

		const away = await paired.device
			.space(a.spaceId)
			.startRun({ projectId, flow: quickFlow });
		await untilStatus(paired.device, away.id, "finished");
		expect(await statusOn(paired.host, away.id)).toBeNull();

		paired.memory.up();
		await untilStatus(paired.host, away.id, "finished");
		await waitFor(
			async () =>
				(await eventsOf(a, away.id)).length ===
				(await eventsOf(b, away.id)).length,
		);
		// Every event once, on both runs.
		for (const id of [before.id, away.id]) {
			expect(await eventsOf(a, id)).toEqual(await eventsOf(b, id));
		}
	});

	test("a key A no longer knows ends the link: revoked, and nothing more goes to A", async () => {
		let removed = false;
		const period = online(
			paired.memory.client(() => (removed ? null : paired.key)),
		);
		const before = await walkOnB(quickFlow);
		await untilStatus(paired.host, before.id, "finished");

		// A's owner removes B's access.
		removed = true;
		await waitFor(() => status(period) === "revoked", { label: "revoked" });
		const after = await paired.device
			.space(a.spaceId)
			.startRun({ projectId, flow: quickFlow });
		await untilStatus(paired.device, after.id, "finished");
		await Bun.sleep(100);
		expect(await statusOn(paired.host, after.id)).toBeNull();
	});

	test("a Space B's owner is not a Member of never reaches B", async () => {
		// Another Person's Space on A, with a run of A's own.
		const now = Date.now();
		await a.db.insert(user).values({
			id: "stranger",
			name: "Stranger",
			email: "stranger@example.invalid",
		});
		await a.db.insert(organization).values({
			id: "space-private",
			name: "Private",
			slug: "space-private",
			createdAt: new Date(now),
			personal: false,
		});
		await a.db.insert(member).values({
			id: "m-stranger",
			organizationId: "space-private",
			userId: "stranger",
			role: "owner",
			createdAt: new Date(now),
		});
		await a.db.insert(project).values({
			id: "project-private",
			spaceId: "space-private",
			name: "Private",
		});
		await a.db.insert(runTable).values({
			id: "run-private",
			spaceId: "space-private",
			projectId: "project-private",
			flow: "{}",
			bodyFlows: "{}",
			title: "Private run",
			worktreePath: "/nowhere",
			branch: "nightshift/private",
			baseRef: "main",
			walkerId: a.deviceId,
		});
		await a.db.insert(event).values({
			spaceId: "space-private",
			runId: "run-private",
			type: "RunStarted",
			payload: "{}",
			walkerId: a.deviceId,
			walkerSeq: 1_000_000,
		});
		// A run in A's Space that B does take part in.
		await paired.projectOnDevice(projectId);
		const shared = await paired.host
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });

		online();
		await untilStatus(paired.device, shared.id, "waiting");
		const leaked = await b.db
			.select()
			.from(runTable)
			.where(eq(runTable.spaceId, "space-private"));
		expect(leaked).toEqual([]);
		expect(
			Object.keys(await paired.device.exchange.rows.cursorsWith(paired.hostId)),
		).not.toContain("space-private");
		// And not by the archive either.
		expect(
			await paired.memory.client(paired.key).archive.get({
				ref: {
					kind: "checkpoint",
					spaceId: "space-private",
					runId: "run-private",
				},
			}),
		).toBeNull();
	});
});

describe("live transcripts over the exchange", () => {
	test("A shows the running step B walks, and B stops sending when nobody watches", async () => {
		const marker = join(b.dataDir, "go");
		const run = await walkOnB(slowFlow(marker));
		const client = paired.memory.client(paired.key);
		let tails = 0;
		online({
			...client,
			archive: {
				...client.archive,
				tail: (input, options) => {
					tails++;
					return client.archive.tail(input, options);
				},
			},
		});
		await waitFor(
			async () =>
				(
					await paired.host
						.space(a.spaceId)
						.getRun(run.id)
						.catch(() => null)
				)?.steps[0]?.endedAt === null,
			{ label: "the running step on A" },
		);
		expect(tails).toBe(0);

		const watching = watch(paired.host, run.id);
		await waitFor(() => watching.lines().includes("first"), {
			label: "the first line on A",
		});
		// Still running: the line came live, not from the archive.
		expect(
			(await paired.host.space(a.spaceId).getRun(run.id)).steps[0]?.endedAt,
		).toBeNull();

		await Bun.write(marker, "");
		await waitFor(() => watching.lines().includes("second"), {
			label: "the second line on A",
		});
		expect(watching.lines()).toEqual(["first", "second"]);
		await watching.stop();
		await waitFor(
			() => paired.host.exchange.feeds.wanted(b.deviceId).length === 0,
		);
		expect(tails).toBeGreaterThan(0);
		await untilStatus(paired.device, run.id, "finished");
	});

	test("B shows the running step A walks, and resumes from its cursor with nothing twice", async () => {
		const marker = join(a.dataDir, "go");
		await paired.projectOnDevice(projectId);
		const run = await paired.host
			.space(a.spaceId)
			.startRun({ projectId, flow: slowFlow(marker) });
		online();
		await waitFor(
			async () =>
				(
					await paired.device
						.space(a.spaceId)
						.getRun(run.id)
						.catch(() => null)
				)?.steps[0]?.endedAt === null,
			{ label: "the running step on B" },
		);

		const first = watch(paired.device, run.id);
		await waitFor(() => first.lines().includes("first"), {
			label: "the first line on B",
		});
		expect(
			(await paired.host.space(a.spaceId).getRun(run.id)).steps[0]?.endedAt,
		).toBeNull();
		await first.stop();

		// Back from its last entry: what follows, nothing twice.
		const again = watch(paired.device, run.id, first.seqs().at(-1));
		await Bun.write(marker, "");
		await waitFor(() => again.lines().includes("second"), {
			label: "the second line on B",
		});
		expect(again.lines()).toEqual(["second"]);
		const seen = [...first.seqs(), ...again.seqs()];
		expect(new Set(seen).size).toBe(seen.length);
		await again.stop();
		await untilStatus(paired.host, run.id, "finished");
	});

	test("B shows a step A reopened whole, not the copy it kept of the step's first end", async () => {
		await paired.projectOnDevice(projectId);
		const onA = paired.host.space(a.spaceId, { personId: paired.personId });
		const run = await onA.startRun({ projectId, flow: agentFlow });
		const step = await waitFor(
			async () => (await onA.getRun(run.id)).steps[0]?.id,
			{ label: "the step on A" },
		);
		const onDisk = join(a.dataDir, "transcripts", run.id, `${step}.ndjson`);
		await waitFor(
			async () =>
				(
					await Bun.file(onDisk)
						.text()
						.catch(() => "")
				).includes("first part"),
			{ label: "the first part on A" },
		);
		await onA.stopRun(run.id);
		await untilStatus(paired.host, run.id, "stopped");
		online();
		await untilStatus(paired.device, run.id, "stopped");

		// B reads the ended step from A, and keeps the copy.
		const first = watchItems(paired.device, run.id);
		await waitFor(() => textOf(first.items, step).includes("first part"), {
			label: "the step on B",
		});
		await first.stop();
		const ref = {
			kind: "transcript" as const,
			spaceId: a.spaceId,
			runId: run.id,
			stepId: step,
		};
		expect(await paired.device.exchange.readArchive(ref)).not.toBeNull();

		// A resume reopens the step: its session goes on, and the run ends.
		await onA.resumeRun(run.id);
		await untilStatus(paired.host, run.id, "finished");
		await untilStatus(paired.device, run.id, "finished");
		expect((await onA.getRun(run.id)).steps.map((s) => s.id)).toEqual([step]);

		const again = watchItems(paired.device, run.id);
		await waitFor(() => textOf(again.items, step).includes("second part"), {
			label: "the reopened step on B",
			timeoutMs: 3_000,
		}).catch(() => {});
		await again.stop();
		expect(textOf(again.items, step)).toContain("second part");
	});

	test("C, a third Replica, reads a step B reopened between B's rows and B's copy, and shows its second end", async () => {
		const c = await createSandbox();
		others.push(c);
		const viewer = await paired.pair(c, "C");
		await viewer.projectOnDevice(projectId);

		// B's copies of the transcript wait at the Host's door while `held`.
		let held = false;
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const client = paired.memory.client(paired.key);
		online({
			...client,
			archive: {
				...client.archive,
				put: (async (input, options) => {
					if (held && input.ref.kind === "transcript") await gate;
					return client.archive.put(input, options);
				}) as HostClient["archive"]["put"],
			},
		});
		const run = await walkOnB(agentFlow);
		const onB = paired.device.space(a.spaceId, { personId: paired.personId });
		const step = await waitFor(
			async () => (await onB.getRun(run.id)).steps[0]?.id,
			{ label: "the step on B" },
		);
		const ref = {
			kind: "transcript" as const,
			spaceId: a.spaceId,
			runId: run.id,
			stepId: step,
		};
		const onDisk = join(b.dataDir, "transcripts", run.id, `${step}.ndjson`);
		await waitFor(
			async () =>
				(
					await Bun.file(onDisk)
						.text()
						.catch(() => "")
				).includes("first part"),
			{ label: "the first part on B" },
		);
		await onB.stopRun(run.id);
		await untilStatus(paired.host, run.id, "stopped");
		await waitFor(
			async () =>
				(await paired.hostExchange.archiveGet(paired.key, ref))?.includes(
					"first part",
				),
			{ label: "the copy of the first end on A" },
		);

		// The step ends again. Its rows reach A, its copy does not yet.
		held = true;
		await onB.resumeRun(run.id);
		/** The step ended after its reopen, as `engine` knows it. */
		const endedAgain = (engine: PeerEngine) =>
			waitFor(
				async () => {
					const steps = await engine
						.space(a.spaceId)
						.getRun(run.id)
						.then((r) => r.steps)
						.catch(() => []);
					return steps[0]?.endedAt != null && steps[0].sessions.length === 2;
				},
				{ label: "the second end of the step" },
			);
		await endedAgain(paired.host);
		online(
			paired.memory.client(viewer.key),
			deviceExchange(viewer.engine, c.deviceId),
		);
		await endedAgain(viewer.engine);

		// C reads the step now: never the copy of the first end as the whole step.
		const between = watchItems(viewer.engine, run.id);
		await waitFor(() => textOf(between.items, step).includes("second part"), {
			label: "the second end on C, before the copy",
			timeoutMs: 3_000,
		}).catch(() => {});
		await between.stop();
		expect(await viewer.engine.exchange.readArchive(ref)).toBeNull();

		// The copy lands. C reads the step again.
		release();
		await waitFor(
			async () =>
				(await paired.hostExchange.archiveGet(paired.key, ref))?.includes(
					"second part",
				),
			{ label: "the copy of the second end on A" },
		);
		const after = watchItems(viewer.engine, run.id);
		await waitFor(() => textOf(after.items, step).includes("second part"), {
			label: "the second end on C",
			timeoutMs: 3_000,
		}).catch(() => {});
		await after.stop();

		expect(textOf(between.items, step)).toContain("second part");
		expect(textOf(after.items, step)).toContain("second part");
	}, 20_000);

	test("A shows each item's output of a For Each B walked, in seq order, from its archive", async () => {
		const run = await walkOnB(await forEachFlow(b.repoPath));
		await untilStatus(paired.device, run.id, "finished");
		online();
		await untilStatus(paired.host, run.id, "finished");
		// B's ended steps' files reach A's archive after their rows.
		const steps = (await paired.host.space(a.spaceId).getRun(run.id)).steps;
		await waitFor(
			async () => {
				for (const s of steps) {
					const ref = {
						kind: "transcript" as const,
						spaceId: a.spaceId,
						runId: run.id,
						stepId: s.id,
					};
					if ((await paired.host.exchange.readArchive(ref)) === null) {
						return false;
					}
				}
				return true;
			},
			{ label: "B's transcripts in A's archive" },
		);

		const watching = watch(paired.host, run.id);
		await waitFor(() => watching.lines().length >= 3, {
			label: "the items' output on A",
			timeoutMs: 2_000,
		}).catch(() => {});
		await watching.stop();
		expect(watching.lines()).toEqual(["item 1", "item 2", "item 3"]);
		const seqs = watching.seqs();
		expect(seqs).toEqual(seqs.map((_, i) => i + 1));
	});
});
